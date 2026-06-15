import type { ChainDto, ChainMemberDto } from '@moment/dto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';

const app = createApp();

interface Fixture {
  owner: TestUser;
  editor: TestUser;
  viewer: TestUser;
  outsider: TestUser;
  chain: ChainDto;
}

async function setup(): Promise<Fixture> {
  const owner = await createUser(app, 'owner@example.com');
  const editor = await createUser(app, 'editor@example.com');
  const viewer = await createUser(app, 'viewer@example.com');
  const outsider = await createUser(app, 'outsider@example.com');
  const chain = await createChain(app, owner, '成员测试链');
  await addMember(chain.id, editor.id, 'editor');
  await addMember(chain.id, viewer.id, 'viewer');
  return { owner, editor, viewer, outsider, chain };
}

beforeEach(resetDb);
afterAll(closeDb);

describe('GET /api/chains/:chainId/members', () => {
  it('viewer+ 成员可见成员列表（含角色与昵称）；非成员 404', async () => {
    const { owner, editor, viewer, outsider, chain } = await setup();
    const res = await request(app)
      .get(`/api/chains/${chain.id}/members`)
      .set('Authorization', auth(viewer));
    expect(res.status).toBe(200);
    const members = res.body as ChainMemberDto[];
    expect(members).toHaveLength(3);
    const byUser = Object.fromEntries(members.map((m) => [m.userId, m]));
    expect(byUser[owner.id].role).toBe('owner');
    expect(byUser[editor.id].role).toBe('editor');
    expect(byUser[viewer.id].role).toBe('viewer');
    expect(byUser[owner.id].nickname).toBe('owner');

    const nf = await request(app)
      .get(`/api/chains/${chain.id}/members`)
      .set('Authorization', auth(outsider));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('PATCH /api/chains/:chainId/members/:userId', () => {
  it('owner 改他人角色 editor→viewer 200', async () => {
    const { owner, editor, chain } = await setup();
    const res = await request(app)
      .patch(`/api/chains/${chain.id}/members/${editor.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(editor.id);
    expect(res.body.role).toBe('viewer');
  });

  it('owner 改自己 400 CANNOT_CHANGE_OWN_ROLE；改成 owner 被 schema 拒 400', async () => {
    const { owner, editor, chain } = await setup();
    const self = await request(app)
      .patch(`/api/chains/${chain.id}/members/${owner.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'editor' });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');

    const toOwner = await request(app)
      .patch(`/api/chains/${chain.id}/members/${editor.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'owner' });
    expect(toOwner.status).toBe(400);
    expect(toOwner.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('editor 改角色 403；目标非成员 404 MEMBER_NOT_FOUND', async () => {
    const { owner, editor, viewer, outsider, chain } = await setup();
    const forbidden = await request(app)
      .patch(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(editor))
      .send({ role: 'viewer' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const nf = await request(app)
      .patch(`/api/chains/${chain.id}/members/${outsider.id}`)
      .set('Authorization', auth(owner))
      .send({ role: 'viewer' });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('MEMBER_NOT_FOUND');
  });
});

describe('DELETE /api/chains/:chainId/members/:userId', () => {
  it('owner 移除他人 204；本人退链 204；owner 退链 409 OWNER_MUST_TRANSFER', async () => {
    const { owner, editor, viewer, chain } = await setup();

    const byeViewer = await request(app)
      .delete(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(owner));
    expect(byeViewer.status).toBe(204);

    const selfLeave = await request(app)
      .delete(`/api/chains/${chain.id}/members/${editor.id}`)
      .set('Authorization', auth(editor));
    expect(selfLeave.status).toBe(204);

    const ownerLeave = await request(app)
      .delete(`/api/chains/${chain.id}/members/${owner.id}`)
      .set('Authorization', auth(owner));
    expect(ownerLeave.status).toBe(409);
    expect(ownerLeave.body.error.code).toBe('OWNER_MUST_TRANSFER');

    const remaining = await db.select().from(chainMembers).where(eq(chainMembers.chainId, chain.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(owner.id);
  });

  it('editor 移除他人 403；目标非成员 404 MEMBER_NOT_FOUND；非成员操作 404 CHAIN_NOT_FOUND', async () => {
    const { owner, editor, viewer, outsider, chain } = await setup();
    const forbidden = await request(app)
      .delete(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const nf = await request(app)
      .delete(`/api/chains/${chain.id}/members/${outsider.id}`)
      .set('Authorization', auth(owner));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('MEMBER_NOT_FOUND');

    const stranger = await request(app)
      .delete(`/api/chains/${chain.id}/members/${viewer.id}`)
      .set('Authorization', auth(outsider));
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('POST /api/chains/:chainId/transfer', () => {
  it('owner 转让：同事务改两边角色与 chains.owner_id；旧 owner 变 editor', async () => {
    const { owner, editor, viewer, chain } = await setup();
    const res = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(owner))
      .send({ userId: editor.id });
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe(editor.id);
    expect(res.body.myRole).toBe('editor');

    const rows = await db
      .select()
      .from(chainMembers)
      .where(and(eq(chainMembers.chainId, chain.id)));
    const roleOf = Object.fromEntries(rows.map((r) => [r.userId, r.role]));
    expect(roleOf[owner.id]).toBe('editor');
    expect(roleOf[editor.id]).toBe('owner');

    const [updated] = await db.select().from(chains).where(eq(chains.id, chain.id));
    expect(updated.ownerId).toBe(editor.id);

    // 转让后：新 owner 可改链设置，旧 owner 不可
    const ok = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(editor))
      .send({ name: '新 owner 改名' });
    expect(ok.status).toBe(200);
    const no = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ name: '旧 owner 改名' });
    expect(no.status).toBe(403);

    const preview = res.body as ChainDto;
    expect(preview.memberCount).toBe(3);
    const byUser = Object.fromEntries(preview.membersPreview.map((m) => [m.userId, m]));
    expect(byUser[editor.id].role).toBe('owner');
    expect(byUser[owner.id].role).toBe('editor');
    expect(new Set(preview.membersPreview.map((m) => m.userId))).toEqual(
      new Set([owner.id, editor.id, viewer.id]),
    );
    expect(byUser[editor.id]).not.toHaveProperty('email');
    expect(byUser[editor.id]).not.toHaveProperty('joinedAt');
  });

  it('转给自己 400 CANNOT_TRANSFER_TO_SELF；目标非成员 404；非 owner 发起 403', async () => {
    const { owner, editor, outsider, chain } = await setup();
    const self = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(owner))
      .send({ userId: owner.id });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_TRANSFER_TO_SELF');

    const nf = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(owner))
      .send({ userId: outsider.id });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('MEMBER_NOT_FOUND');

    const forbidden = await request(app)
      .post(`/api/chains/${chain.id}/transfer`)
      .set('Authorization', auth(editor))
      .send({ userId: owner.id });
    expect(forbidden.status).toBe(403);
  });
});
