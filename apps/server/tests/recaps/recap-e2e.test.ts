import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { notifications, pushTokens, recaps } from '../../src/db/schema.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { handleRecapGenerate } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment } from '../helpers/fixtures.js';
import type { PushSendOutcome, PushService } from '../../src/push/push-service.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;
let member: TestUser;
const mockSend = jest.fn(async (): Promise<PushSendOutcome> => ({ invalidTokens: [] }));
const mockPush = { send: mockSend } as unknown as PushService;

beforeEach(async () => {
  await resetDb();
  mockSend.mockClear();
  owner = await createUser(app, 'alice');
  member = await createUser(app, 'bob');
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

/** 直插有效 push token，让 fanoutNotifications 的 push 路径被实际调用。 */
async function registerPushToken(userId: string): Promise<void> {
  await db.insert(pushTokens).values({
    id: randomUUID(),
    userId,
    expoToken: `ExponentPushToken[${userId.slice(0, 8)}]`,
    platform: 'ios',
  });
}

/** mock provider：chat 返回指定 content + highlight_moment_ids + usage */
function mockProvider(content: string, highlightIds: string[]): LLMProvider {
  return {
    async chat() {
      return {
        content: JSON.stringify({ content, highlight_moment_ids: highlightIds }),
        model: 'mock-model',
        usage: { prompt: 100, completion: 50, total: 150 },
      };
    },
  };
}

describe('recap 正常流 e2e（spec §1/§6/§7/§9）', () => {
  it('建链 → 发 milestone/metric/mood/geo moment → 触发生成 → recaps 行落库 status=ready + highlights', async () => {
    const chain = await createChain(app, owner, '宝宝成长', 'baby');
    const m1 = await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '今天会笑了', kind: 'milestone', payload: { catalog_key: 'first-smile' },
    });
    const m2 = await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-15T01:00:00Z'),
      content: '量身高', kind: 'metric', payload: { metric: 'height', value: 62, unit: 'cm' },
    });
    setLLMProvider(mockProvider('## 7月回顾\n本月宝宝第一次微笑，身高 62cm。', [m1, m2]));

    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chain.id));
    expect(recap.status).toBe('ready');
    expect(recap.content).toContain('7月回顾');
    expect(recap.highlights).toEqual(expect.arrayContaining([m1, m2]));
    expect(recap.model).toBe('mock-model');
    expect(recap.tokenUsage).toEqual({ prompt: 100, completion: 50, total: 150 });
    expect(recap.generatedAt).toBeInstanceOf(Date);
  });

  it('recap.ready 通知扇出给链全体成员（含 push）', async () => {
    const chain = await createChain(app, owner, '宝宝成长', 'baby');
    await addMember(chain.id, member.id, 'viewer');
    await registerPushToken(owner.id);
    await registerPushToken(member.id);
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '记录',
    });
    setLLMProvider(mockProvider('回顾', []));

    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(2); // owner + member
    const userIds = notifs.map((n) => n.userId).sort();
    expect(userIds).toEqual([member.id, owner.id].sort());
    expect(mockSend).toHaveBeenCalled();
    // payload 含 chainId + period
    const payload = notifs[0]!.payload as Record<string, unknown>;
    expect(payload.chainId).toBe(chain.id);
    expect(payload.period).toBe('2026-07');
  });

  it('全管线流：POST .../regenerate → runOutboxBatch 消费 → recaps 落库 + 通知', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '七月记录',
    });
    setLLMProvider(mockProvider('## 7月回顾\n七月很美好。', []));

    // editor 触发重生成
    const res = await request(app)
      .post(`/api/chains/${chain.id}/recaps/2026-07/regenerate`)
      .set('Authorization', auth(owner));
    expect(res.status).toBe(202);

    // 手动消费 outbox（对齐 processor.test.ts 范式）
    const result = await runOutboxBatch({ push: mockPush });
    expect(result.done).toBeGreaterThanOrEqual(1);

    // recaps 落库
    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chain.id));
    expect(recap.status).toBe('ready');
    expect(recap.content).toContain('7月回顾');

    // 通知扇出
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs.length).toBeGreaterThanOrEqual(1);
  });

  it('分享页匿名可读 recap 字段（spec §6 + S2：含 ready）', async () => {
    const chain = await createChain(app, owner, '宝宝成长', 'baby');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '记录',
    });
    setLLMProvider(mockProvider('7月回顾内容', []));
    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    // 建分享链接
    const link = await request(app)
      .post(`/api/chains/${chain.id}/share-links`)
      .set('Authorization', auth(owner))
      .send({});
    expect(link.status).toBe(201);

    // 匿名读分享页
    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.recap).toBeTruthy();
    expect(pub.body.recap.period).toBe('2026-07');
    expect(pub.body.recap.status).toBe('ready');
    expect(pub.body.recap.content).toContain('7月回顾');
  });

  it('GET /api/chains/:chainId/recaps period 倒序（spec §6）', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z'),
      content: '六月',
    });
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-15T01:00:00Z'),
      content: '七月',
    });
    // 生成两期
    setLLMProvider(mockProvider('六月回顾', []));
    await handleRecapGenerate({ chainId: chain.id, period: '2026-06' }, { push: mockPush });
    setLLMProvider(mockProvider('七月回顾', []));
    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    const res = await request(app)
      .get(`/api/chains/${chain.id}/recaps`)
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.recaps).toHaveLength(2);
    expect(res.body.recaps[0].period).toBe('2026-07'); // 倒序
    expect(res.body.recaps[1].period).toBe('2026-06');
  });
});
