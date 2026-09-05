import type { ChainDto, InviteDto } from '@moment/dto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainInvites, outbox } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let invitee: TestUser;
let chain: ChainDto;

async function createInvite(user: TestUser, chainId: string, body: object = {}): Promise<InviteDto> {
  const res = await request(app)
    .post(`/api/chains/${chainId}/invites`)
    .set('Authorization', auth(user))
    .send(body);
  if (res.status !== 201) {
    throw new Error(`createInvite failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as InviteDto;
}

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  editor = await createUser(app, 'editor@example.com');
  viewer = await createUser(app, 'viewer@example.com');
  invitee = await createUser(app, 'invitee@example.com');
  chain = await createChain(app, owner, '邀请测试链');
  await addMember(chain.id, editor.id, 'editor');
  await addMember(chain.id, viewer.id, 'viewer');
});
afterAll(closeDb);

describe('POST /api/chains/:chainId/invites', () => {
  it('owner/editor 可创建：token 64 字符不可猜测，role 默认 editor，过期约 7 天，email 归一化', async () => {
    const byOwner = await createInvite(owner, chain.id, { email: '  Invited@Example.COM ' });
    expect(byOwner.token).toHaveLength(64);
    expect(byOwner.role).toBe('editor');
    expect(byOwner.email).toBe('invited@example.com');
    expect(byOwner.chainId).toBe(chain.id);
    expect(byOwner.acceptedAt).toBeNull();
    expect(new Date(byOwner.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const byEditor = await createInvite(editor, chain.id, { role: 'viewer' });
    expect(byEditor.role).toBe('viewer');

    // 两次 token 不同（不可猜测随机）
    expect(byEditor.token).not.toBe(byOwner.token);
  });

  it('email 命中已注册非成员：同事务写 invite.created outbox；无 email / 已是成员不写', async () => {
    const withUser = await createInvite(owner, chain.id, { email: 'invitee@example.com' });
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'invite.created'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      inviteId: withUser.id,
      inviteToken: withUser.token,
      chainId: chain.id,
      actorId: owner.id,
      inviteeId: invitee.id,
    });

    await createInvite(owner, chain.id, {});
    await createInvite(owner, chain.id, { email: 'editor@example.com' });
    const again = await db.select().from(outbox).where(eq(outbox.type, 'invite.created'));
    expect(again).toHaveLength(1);
  });

  it('viewer 创建 403；role=owner 400；非成员 404', async () => {
    const forbidden = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(viewer))
      .send({});
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const badRole = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(owner))
      .send({ role: 'owner' });
    expect(badRole.status).toBe(400);

    const stranger = await createUser(app, 'stranger@example.com');
    const nf = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(stranger))
      .send({});
    expect(nf.status).toBe(404);
  });
});

describe('GET /api/chains/:chainId/invites', () => {
  it('owner 可见列表；editor 403', async () => {
    const invite = await createInvite(owner, chain.id);
    const res = await request(app)
      .get(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const list = res.body as InviteDto[];
    expect(list).toHaveLength(1);
    expect(list[0].token).toBe(invite.token);

    const forbidden = await request(app)
      .get(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);
  });
});

describe('DELETE /api/invites/:inviteId', () => {
  it('owner 吊销 204（硬删）；editor 403；不存在 404 INVITE_NOT_FOUND', async () => {
    const invite = await createInvite(owner, chain.id);

    const forbidden = await request(app)
      .delete(`/api/invites/${invite.id}`)
      .set('Authorization', auth(editor));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const res = await request(app).delete(`/api/invites/${invite.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(204);
    expect(await db.select().from(chainInvites).where(eq(chainInvites.id, invite.id))).toHaveLength(0);

    const nf = await request(app).delete(`/api/invites/${invite.id}`).set('Authorization', auth(owner));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('INVITE_NOT_FOUND');
  });
});

describe('POST /api/invites/:token/accept', () => {
  it('接受成功：同事务写 member + accepted_at；幂等再接受返回 alreadyMember', async () => {
    const invite = await createInvite(owner, chain.id, { role: 'viewer' });

    const res = await request(app)
      .post(`/api/invites/${invite.token}/accept`)
      .set('Authorization', auth(invitee));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chainId: chain.id, role: 'viewer', alreadyMember: false });

    const [row] = await db.select().from(chainInvites).where(eq(chainInvites.id, invite.id));
    expect(row.acceptedAt).not.toBeNull();

    // 幂等：已是成员再接受 → 200 原角色，不写库
    const again = await request(app)
      .post(`/api/invites/${invite.token}/accept`)
      .set('Authorization', auth(invitee));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ chainId: chain.id, role: 'viewer', alreadyMember: true });

    // invitee 现在能以 viewer 身份读链
    const detail = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(invitee));
    expect(detail.status).toBe(200);
    expect(detail.body.myRole).toBe('viewer');
  });

  it('email 绑定的邀请：邮箱不匹配 403 INVITE_EMAIL_MISMATCH；匹配则放行', async () => {
    const bound = await createInvite(owner, chain.id, { email: 'invitee@example.com' });

    // 注意：必须用「非成员」用户测 mismatch——已是成员会命中幂等分支先返回 200
    const other = await createUser(app, 'other@example.com');
    const mismatch = await request(app)
      .post(`/api/invites/${bound.token}/accept`)
      .set('Authorization', auth(other));
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.error.code).toBe('INVITE_EMAIL_MISMATCH');

    const ok = await request(app)
      .post(`/api/invites/${bound.token}/accept`)
      .set('Authorization', auth(invitee));
    expect(ok.status).toBe(200);
    expect(ok.body.alreadyMember).toBe(false);
  });

  it('未知 token 404 INVITE_NOT_FOUND；未登录 401', async () => {
    const nf = await request(app)
      .post(`/api/invites/${'n'.repeat(64)}/accept`)
      .set('Authorization', auth(invitee));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('INVITE_NOT_FOUND');

    const invite = await createInvite(owner, chain.id);
    expect((await request(app).post(`/api/invites/${invite.token}/accept`)).status).toBe(401);
  });

  it('过期 410 INVITE_EXPIRED；已被他人接受 410 INVITE_ALREADY_ACCEPTED', async () => {
    // 直接入库造一个已过期邀请
    await db.insert(chainInvites).values({
      id: 'expired-invite',
      chainId: chain.id,
      token: 'e'.repeat(64),
      role: 'editor',
      createdBy: owner.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await request(app)
      .post(`/api/invites/${'e'.repeat(64)}/accept`)
      .set('Authorization', auth(invitee));
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('INVITE_EXPIRED');

    // invitee 先接受；第二个用户再接受同一 token → 410
    const invite = await createInvite(owner, chain.id);
    await request(app).post(`/api/invites/${invite.token}/accept`).set('Authorization', auth(invitee));
    const late = await createUser(app, 'late@example.com');
    const res = await request(app)
      .post(`/api/invites/${invite.token}/accept`)
      .set('Authorization', auth(late));
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_ALREADY_ACCEPTED');
  });
});
