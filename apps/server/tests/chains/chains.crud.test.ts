import type { ChainDto } from '@moment/dto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainInvites, chainMembers } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  outsider = await createUser(app, 'outsider@example.com');
});
afterAll(closeDb);

describe('POST /api/chains', () => {
  it('201：创建者同事务成为 owner 成员，visibility 默认 private', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '宝宝成长', description: '记录每一天', template: 'daily' });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.name).toBe('宝宝成长');
    expect(chain.description).toBe('记录每一天');
    expect(chain.visibility).toBe('private');
    expect(chain.ownerId).toBe(owner.id);
    expect(chain.myRole).toBe('owner');
    expect(chain.coverMediaId).toBeNull();
    expect(chain.color).toBeNull();
    expect(chain.icon).toBeNull();

    const members = await db.select().from(chainMembers).where(eq(chainMembers.chainId, chain.id));
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(owner.id);
    expect(members[0].role).toBe('owner');
  });

  it('201：可带预设色与图标', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '旅行', color: 'sky', icon: '✈️', template: 'daily' });
    expect(res.status).toBe(201);
    expect(res.body.color).toBe('sky');
    expect(res.body.icon).toBe('✈️');
  });

  it('未登录 401；空 name 400 VALIDATION_ERROR', async () => {
    expect((await request(app).post('/api/chains').send({ name: 'x' })).status).toBe(401);
    const bad = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name: '', template: 'daily' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/chains', () => {
  it('只返回我参与的链，含我的角色', async () => {
    const mine = await createChain(app, owner, '我的链');
    const other = await createChain(app, outsider, '别人的链');
    // owner 以 viewer 身份加入 outsider 的链
    await addMember(other.id, owner.id, 'viewer');

    const res = await request(app).get('/api/chains').set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const list = res.body as ChainDto[];
    expect(list).toHaveLength(2);
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(byId[mine.id].myRole).toBe('owner');
    expect(byId[other.id].myRole).toBe('viewer');

    // outsider 的列表只有自己创建的链
    const res2 = await request(app).get('/api/chains').set('Authorization', auth(outsider));
    const list2 = res2.body as ChainDto[];
    expect(list2.map((c) => c.id)).toEqual([other.id]);
  });
});

describe('GET /api/chains/:chainId', () => {
  it('viewer+ 成员可读；非成员 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const chain = await createChain(app, owner);
    const viewer = await createUser(app, 'viewer@example.com');
    await addMember(chain.id, viewer.id, 'viewer');

    const ok = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(viewer));
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(chain.id);
    expect(ok.body.myRole).toBe('viewer');

    const nf = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(outsider));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');

    expect((await request(app).get(`/api/chains/${chain.id}`)).status).toBe(401);
  });
});

describe('PATCH /api/chains/:chainId', () => {
  it('owner 可改 name/description/visibility；editor/viewer 403；非成员 404；空 patch 400', async () => {
    const chain = await createChain(app, owner);
    const editor = await createUser(app, 'editor@example.com');
    const viewer = await createUser(app, 'viewer@example.com');
    await addMember(chain.id, editor.id, 'editor');
    await addMember(chain.id, viewer.id, 'viewer');

    const res = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ name: '新名字', visibility: 'link', description: null });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('新名字');
    expect(res.body.visibility).toBe('link');
    expect(res.body.description).toBeNull();

    const look = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ color: 'mint', icon: '👶' });
    expect(look.status).toBe(200);
    expect(look.body.color).toBe('mint');
    expect(look.body.icon).toBe('👶');

    const clearIcon = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ icon: null });
    expect(clearIcon.status).toBe(200);
    expect(clearIcon.body.icon).toBeNull();
    expect(clearIcon.body.color).toBe('mint');

    const forbidden = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(editor))
      .send({ name: 'x' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const viewerPatch = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(viewer))
      .send({ name: 'x' });
    expect(viewerPatch.status).toBe(403);
    expect(viewerPatch.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const nf = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(outsider))
      .send({ name: 'x' });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');

    const empty = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/chains/:chainId', () => {
  it('owner 删除 204：members/invites 同事务硬删；editor 403', async () => {
    const chain = await createChain(app, owner);
    const editor = await createUser(app, 'editor@example.com');
    await addMember(chain.id, editor.id, 'editor');
    await db.insert(chainInvites).values({
      id: 'invite-1',
      chainId: chain.id,
      token: 't'.repeat(64),
      role: 'editor',
      createdBy: owner.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const forbidden = await request(app)
      .delete(`/api/chains/${chain.id}`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);

    const res = await request(app).delete(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(204);

    expect(await db.select().from(chainMembers).where(eq(chainMembers.chainId, chain.id))).toHaveLength(0);
    expect(await db.select().from(chainInvites).where(eq(chainInvites.chainId, chain.id))).toHaveLength(0);
    const gone = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(gone.status).toBe(404);
  });
});

function expectPreviewItem(
  actual: unknown,
  expected: { userId: string; nickname: string; role: 'owner' | 'editor' | 'viewer' },
): void {
  expect(actual).toEqual({
    userId: expected.userId,
    nickname: expected.nickname,
    avatarUrl: null,
    role: expected.role,
  });
  expect(actual as object).not.toHaveProperty('email');
  expect(actual as object).not.toHaveProperty('joinedAt');
}

async function setJoinedAt(chainId: string, userId: string, at: Date): Promise<void> {
  await db
    .update(chainMembers)
    .set({ joinedAt: at })
    .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)));
}

describe('ChainDto membersPreview', () => {
  it('POST /chains：预览只有创建者，memberCount === 1', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '预览链', template: 'daily' });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.memberCount).toBe(1);
    expect(chain.membersPreview).toHaveLength(1);
    expectPreviewItem(chain.membersPreview[0], {
      userId: owner.id,
      nickname: 'owner',
      role: 'owner',
    });
  });

  it('GET /chains/:id 三人按 joinedAt 升序；GET /chains 两条链互不串', async () => {
    const chainA = await createChain(app, owner, 'A链');
    const editor = await createUser(app, 'editor@example.com');
    const viewer = await createUser(app, 'viewer@example.com');
    await addMember(chainA.id, editor.id, 'editor');
    await addMember(chainA.id, viewer.id, 'viewer');
    const t0 = new Date('2026-01-01T00:00:00Z');
    await setJoinedAt(chainA.id, owner.id, t0);
    await setJoinedAt(chainA.id, editor.id, new Date(t0.getTime() + 1000));
    await setJoinedAt(chainA.id, viewer.id, new Date(t0.getTime() + 2000));

    const chainSolo = await createChain(app, owner, 'C链');

    const one = await request(app).get(`/api/chains/${chainA.id}`).set('Authorization', auth(owner));
    expect(one.status).toBe(200);
    const detail = one.body as ChainDto;
    expect(detail.memberCount).toBe(3);
    expect(detail.membersPreview.map((m) => m.userId)).toEqual([owner.id, editor.id, viewer.id]);
    expectPreviewItem(detail.membersPreview[0], { userId: owner.id, nickname: 'owner', role: 'owner' });
    expectPreviewItem(detail.membersPreview[1], { userId: editor.id, nickname: 'editor', role: 'editor' });
    expectPreviewItem(detail.membersPreview[2], { userId: viewer.id, nickname: 'viewer', role: 'viewer' });

    const list = await request(app).get('/api/chains').set('Authorization', auth(owner));
    expect(list.status).toBe(200);
    const byId = Object.fromEntries((list.body as ChainDto[]).map((c) => [c.id, c]));
    expect(byId[chainA.id].memberCount).toBe(3);
    expect(byId[chainA.id].membersPreview.map((m) => m.userId)).toEqual([owner.id, editor.id, viewer.id]);
    expect(byId[chainSolo.id].memberCount).toBe(1);
    expect(byId[chainSolo.id].membersPreview).toHaveLength(1);
    expectPreviewItem(byId[chainSolo.id].membersPreview[0], {
      userId: owner.id,
      nickname: 'owner',
      role: 'owner',
    });
  });

  it('第 6 人加入后预览切 5 人，挤掉 joinedAt 最晚者', async () => {
    const chain = await createChain(app, owner, '六人链');
    const extras: TestUser[] = [];
    for (let i = 2; i <= 6; i++) {
      extras.push(await createUser(app, `u${i}@example.com`));
      await addMember(chain.id, extras[i - 2].id, 'viewer');
    }
    const t0 = new Date('2026-02-01T00:00:00Z');
    await setJoinedAt(chain.id, owner.id, t0);
    for (let i = 0; i < extras.length; i++) {
      await setJoinedAt(chain.id, extras[i].id, new Date(t0.getTime() + (i + 1) * 1000));
    }
    const excluded = extras[4]; // u6，最晚

    const res = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const body = res.body as ChainDto;
    expect(body.memberCount).toBe(6);
    expect(body.membersPreview).toHaveLength(5);
    expect(body.membersPreview.map((m) => m.userId)).toEqual([
      owner.id,
      extras[0].id,
      extras[1].id,
      extras[2].id,
      extras[3].id,
    ]);
    expect(body.membersPreview.map((m) => m.userId)).not.toContain(excluded.id);
    expectPreviewItem(body.membersPreview[0], { userId: owner.id, nickname: 'owner', role: 'owner' });
    expectPreviewItem(body.membersPreview[4], { userId: extras[3].id, nickname: 'u5', role: 'viewer' });
  });

  it('仅发出邀请未接受：预览仍只有创建者，响应无邀请邮箱', async () => {
    const chain = await createChain(app, owner, '邀请链');
    const inv = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(owner))
      .send({ email: 'pending@example.com', role: 'editor' });
    expect(inv.status).toBe(201);

    const res = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const body = res.body as ChainDto;
    expect(body.memberCount).toBe(1);
    expect(body.membersPreview).toHaveLength(1);
    expectPreviewItem(body.membersPreview[0], { userId: owner.id, nickname: 'owner', role: 'owner' });
    expect(JSON.stringify(res.body)).not.toContain('pending@example.com');
  });

  it('PATCH visibility 不改预览 userId 与 memberCount', async () => {
    const chain = await createChain(app, owner, '可见性链');
    const editor = await createUser(app, 'ed2@example.com');
    await addMember(chain.id, editor.id, 'editor');
    const before = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    const prev = before.body as ChainDto;

    const res = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ visibility: 'link' });
    expect(res.status).toBe(200);
    const after = res.body as ChainDto;
    expect(after.visibility).toBe('link');
    expect(after.memberCount).toBe(prev.memberCount);
    expect(after.membersPreview.map((m) => m.userId)).toEqual(prev.membersPreview.map((m) => m.userId));
  });

  it('非成员 GET 404 不带 membersPreview；未登录 401；无链列表为 []', async () => {
    const chain = await createChain(app, owner, '私链');
    const nf = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(outsider));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');
    expect(nf.body).not.toHaveProperty('membersPreview');

    expect((await request(app).get(`/api/chains/${chain.id}`)).status).toBe(401);

    const emptyUser = await createUser(app, 'nochains@example.com');
    const empty = await request(app).get('/api/chains').set('Authorization', auth(emptyUser));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
  });
});

