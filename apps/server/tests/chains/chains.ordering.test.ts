import type { ChainDto } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { Container } from 'typedi';
import { createApp } from '../../src/app.js';
import { ChainService } from '../../src/chains/chain.service.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';

// 链排序（spec chain-ordering §3/§4/§5/§7）：
// listMine 按 sort_order ASC（created_at DESC 兜底）；create/acceptInvite 新 membership 置顶（min-1，首链 1）；
// reorder 全量重写（集合恰好匹配、同事务、IN 限定）；退出重进 = 新 membership 回顶部。

const app = listenLocal(createApp());

let owner: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

async function sortOrderOf(chainId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ sortOrder: chainMembers.sortOrder })
    .from(chainMembers)
    .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)))
    .limit(1);
  if (!row) throw new Error(`membership not found: ${chainId}/${userId}`);
  return row.sortOrder;
}

async function listIds(user: TestUser): Promise<string[]> {
  const res = await request(app).get('/api/chains').set('Authorization', auth(user));
  expect(res.status).toBe(200);
  return (res.body as ChainDto[]).map((c) => c.id);
}

async function setSortOrder(chainId: string, userId: string, value: number): Promise<void> {
  await db
    .update(chainMembers)
    .set({ sortOrder: value })
    .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)));
}

async function setCreatedAt(chainId: string, at: Date): Promise<void> {
  await db.update(chains).set({ createdAt: at }).where(eq(chains.id, chainId));
}

/** 走真实 API 建邀请并返回 token（outsider 的链）。 */
async function inviteToken(chainId: string, by: TestUser, role: 'editor' | 'viewer'): Promise<string> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/invites`)
    .set('Authorization', auth(by))
    .send({ role });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('GET /api/chains 按 sort_order 排序（spec §3）', () => {
  it('按 sortOrder ASC；并列按 createdAt DESC 兜底', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const c3 = await createChain(app, owner, '链3');

    await setSortOrder(c1.id, owner.id, 20);
    await setSortOrder(c2.id, owner.id, 10);
    await setSortOrder(c3.id, owner.id, 30);
    expect(await listIds(owner)).toEqual([c2.id, c1.id, c3.id]);

    // 并列（正常回填后不存在，防御性兜底）：createdAt 新者在前
    await setSortOrder(c1.id, owner.id, 10);
    await setCreatedAt(c1.id, new Date('2026-01-01T00:00:00Z'));
    await setCreatedAt(c2.id, new Date('2026-02-01T00:00:00Z'));
    expect(await listIds(owner)).toEqual([c2.id, c1.id, c3.id]);
  });
});

describe('新链 / 新加入的链置顶（spec §4）', () => {
  it('create：首链 sortOrder = 1，次链 = min-1 = 0 并列列表最前', async () => {
    const c1 = await createChain(app, owner, '首链');
    expect(await sortOrderOf(c1.id, owner.id)).toBe(1);

    const c2 = await createChain(app, owner, '次链');
    expect(await sortOrderOf(c2.id, owner.id)).toBe(0);
    expect(await listIds(owner)).toEqual([c2.id, c1.id]);
  });

  it('acceptInvite：新 membership 取 min-1，被邀请的链直接到顶', async () => {
    const mine = await createChain(app, owner, '我的链'); // owner 的 sortOrder = 1
    const theirs = await createChain(app, outsider, '别人的链');
    const token = await inviteToken(theirs.id, outsider, 'editor');

    const accept = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set('Authorization', auth(owner));
    expect(accept.status).toBe(200);

    expect(await sortOrderOf(theirs.id, owner.id)).toBe(0); // min(1) - 1
    expect(await listIds(owner)).toEqual([theirs.id, mine.id]);
  });

  it('退出后重新加入 = 新 membership，回顶部不记忆历史位置', async () => {
    const mine = await createChain(app, owner, '我的链');
    const theirs = await createChain(app, outsider, '别人的链');
    const token1 = await inviteToken(theirs.id, outsider, 'viewer');
    await request(app).post(`/api/invites/${token1}/accept`).set('Authorization', auth(owner));
    // 人为把 owner 在 theirs 上的顺序压到底部，模拟「历史位置」
    await setSortOrder(theirs.id, owner.id, 99);

    // viewer 自己退链（已接受过的邀请不能复用：acceptedAt 已写）
    const leave = await request(app)
      .delete(`/api/chains/${theirs.id}/members/${owner.id}`)
      .set('Authorization', auth(owner));
    expect(leave.status).toBe(204);

    // 重新接受新邀请 → 新 membership 回顶部（min(1) - 1 = 0，不是 99）
    const token2 = await inviteToken(theirs.id, outsider, 'viewer');
    const rejoin = await request(app)
      .post(`/api/invites/${token2}/accept`)
      .set('Authorization', auth(owner));
    expect(rejoin.status).toBe(200);

    expect(await sortOrderOf(theirs.id, owner.id)).toBe(0);
    expect(await listIds(owner)).toEqual([theirs.id, mine.id]);
  });
});

describe('PUT /api/chains/order（spec §5）', () => {
  it('204：全量重写 sortOrder 为提交顺序的 1..n，列表随即按新顺序返回', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const c3 = await createChain(app, owner, '链3');

    const res = await request(app)
      .put('/api/chains/order')
      .set('Authorization', auth(owner))
      .send({ chainIds: [c1.id, c2.id, c3.id] });
    expect(res.status).toBe(204);

    expect(await sortOrderOf(c1.id, owner.id)).toBe(1);
    expect(await sortOrderOf(c2.id, owner.id)).toBe(2);
    expect(await sortOrderOf(c3.id, owner.id)).toBe(3);
    expect(await listIds(owner)).toEqual([c1.id, c2.id, c3.id]);
  });

  it('幂等：重复提交同一顺序两次均 204 且无副作用', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const body = { chainIds: [c1.id, c2.id] };

    const first = await request(app).put('/api/chains/order').set('Authorization', auth(owner)).send(body);
    const second = await request(app).put('/api/chains/order').set('Authorization', auth(owner)).send(body);
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await sortOrderOf(c1.id, owner.id)).toBe(1);
    expect(await sortOrderOf(c2.id, owner.id)).toBe(2);
    expect(await listIds(owner)).toEqual([c1.id, c2.id]);
  });

  it('空数组：无链用户的恒等提交 204', async () => {
    const lonely = await createUser(app, 'lonely@example.com');
    const res = await request(app)
      .put('/api/chains/order')
      .set('Authorization', auth(lonely))
      .send({ chainIds: [] });
    expect(res.status).toBe(204);
  });

  it('400 CHAIN_ORDER_MISMATCH：漏 id / 多他人链 id / 未知 id；且不作任何写入', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const theirs = await createChain(app, outsider, '别人的链');
    const before1 = await sortOrderOf(c1.id, owner.id);
    const before2 = await sortOrderOf(c2.id, owner.id);

    for (const chainIds of [[c1.id], [c1.id, c2.id, theirs.id], [c1.id, c2.id, 'no-such-chain']]) {
      const res = await request(app)
        .put('/api/chains/order')
        .set('Authorization', auth(owner))
        .send({ chainIds });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CHAIN_ORDER_MISMATCH');
    }
    // 校验失败整体回滚：既有顺序不变
    expect(await sortOrderOf(c1.id, owner.id)).toBe(before1);
    expect(await sortOrderOf(c2.id, owner.id)).toBe(before2);
  });

  it('未登录 401', async () => {
    const res = await request(app).put('/api/chains/order').send({ chainIds: [] });
    expect(res.status).toBe(401);
  });

  it('重写限定 chain_id IN：校验后并发入链的置顶行不被改写（spec §5.2/§7 顺序模拟）', async () => {
    const c1 = await createChain(app, owner, '链1');
    const c2 = await createChain(app, owner, '链2');
    const late = { id: randomUUID() };

    // spec §7：--runInBand 下真实并发难以确定性复现——经 service 测试钩子在 reorder 事务
    // 校验之后、重写之前注入一条新 membership（等价于并发入链的 min-1 置顶行）。
    const service = Container.get(ChainService);
    service.reorderAfterValidateHook = async (userId: string) => {
      await db.insert(chains).values({ id: late.id, name: '并发入链', ownerId: userId, template: 'daily' });
      await db.insert(chainMembers).values({ chainId: late.id, userId, role: 'owner', sortOrder: 0 });
    };
    try {
      const res = await request(app)
        .put('/api/chains/order')
        .set('Authorization', auth(owner))
        .send({ chainIds: [c2.id, c1.id] });
      expect(res.status).toBe(204);
    } finally {
      service.reorderAfterValidateHook = null;
    }

    // 提交集合内的行被重写；并发入链的置顶行（sortOrder 0）不在 IN 集合内，保持原值
    expect(await sortOrderOf(c2.id, owner.id)).toBe(1);
    expect(await sortOrderOf(c1.id, owner.id)).toBe(2);
    expect(await sortOrderOf(late.id, owner.id)).toBe(0);
  });
});
