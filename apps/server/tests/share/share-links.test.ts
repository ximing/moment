import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chains, shareLinks } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, registerUser } from '../helpers/fixtures.js';

let owner: { id: string; token: string };
let editor: { id: string; token: string };
let viewer: { id: string; token: string };
let outsider: { id: string; token: string };
let chainId: string;

beforeEach(async () => {
  await resetDb();
  owner = await registerUser();
  editor = await registerUser();
  viewer = await registerUser();
  outsider = await registerUser();
  chainId = await createChain(owner.id, '宝宝成长');
  await addMember(chainId, editor.id, 'editor');
  await addMember(chainId, viewer.id, 'viewer');
});
afterAll(closeDb);

describe('POST /api/chains/:chainId/share-links', () => {
  it('owner 创建：201，token 为 64 字符 hex，默认永不过期', async () => {
    const res = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.expiresAt).toBeNull();
    expect(res.body.revokedAt).toBeNull();
    expect(res.body.chainId).toBe(chainId);
  });

  it('带 expiresAt：透传 ISO 时间', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt });
    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBe(expiresAt);
  });

  it('editor/viewer 创建 → 403 CHAIN_ROLE_INSUFFICIENT；非成员 → 404 CHAIN_NOT_FOUND', async () => {
    const asEditor = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({});
    expect(asEditor.status).toBe(403);
    expect(asEditor.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const asViewer = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({});
    expect(asViewer.status).toBe(403);

    const asOutsider = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({});
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('非法 expiresAt → 400 VALIDATION_ERROR；未登录 → 401', async () => {
    const bad = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ expiresAt: 'not-a-date' });
    expect(bad.status).toBe(400);

    const anon = await request(app).post(`/api/chains/${chainId}/share-links`).send({});
    expect(anon.status).toBe(401);
  });
});

describe('GET /api/chains/:chainId/share-links', () => {
  it('owner 列表：含已吊销，createdAt 倒序；非 owner → 403', async () => {
    const a = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    const b = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    await request(app)
      .delete(`/api/share-links/${a.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    const res = await request(app)
      .get(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].id).toBe(b.body.id); // 倒序：后建在前
    expect(res.body.items[1].revokedAt).not.toBeNull();

    const denied = await request(app)
      .get(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(denied.status).toBe(403);
  });
});

describe('DELETE /api/share-links/:id', () => {
  it('owner 吊销 204；重复吊销幂等 204；库中 revoked_at 落库', async () => {
    const created = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});

    const del = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(204);

    const again = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(again.status).toBe(204);

    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, created.body.id));
    expect(row.revokedAt).not.toBeNull();
  });

  it('editor 吊销 → 403；非成员 → 404；不存在 id → 404 SHARE_LINK_NOT_FOUND', async () => {
    const created = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});

    const asEditor = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(asEditor.status).toBe(403);

    const asOutsider = await request(app)
      .delete(`/api/share-links/${created.body.id}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(asOutsider.status).toBe(404);

    const missing = await request(app)
      .delete('/api/share-links/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SHARE_LINK_NOT_FOUND');
  });
});

describe('删链级联（Task 2 兑现）', () => {
  it('含 share link 的链可正常删除（204），share_links 行同步清除', async () => {
    await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    const res = await request(app)
      .delete(`/api/chains/${chainId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(shareLinks).where(eq(shareLinks.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(chains).where(eq(chains.id, chainId))).toHaveLength(0);
  });
});
