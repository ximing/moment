import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chains, media, momentTags, moments, outbox, tags } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage } from '../helpers/storage.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = createApp();

let storage: Record<string, import('@jest/globals').jest.Mock>;
let alice: { id: string; token: string };
let bob: { id: string; token: string };
let carol: { id: string; token: string };
let chainId: string;

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
  carol = await createUser(app, 'carol');
  chainId = await createChainWithMembers(alice.id, [
    { userId: bob.id, role: 'editor' },
    { userId: carol.id, role: 'viewer' },
  ]);
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 直插 N 条 moment：5 个不同时间戳 × 每个时间戳 5 条（同 happened_at 跨页场景）。 */
async function insertFlatMoments(): Promise<string[]> {
  const ids: string[] = [];
  const base = Date.UTC(2026, 7, 15, 0, 0, 0);
  const rows = [];
  for (let t = 0; t < 5; t++) {
    for (let k = 0; k < 5; k++) {
      const id = randomUUID();
      ids.push(id);
      rows.push({
        id,
        chainId,
        authorId: alice.id,
        type: 'text' as const,
        content: `m-${t}-${k}`,
        happenedAt: new Date(base - t * 3600_000),
        happenedTzOffset: -480,
      });
    }
  }
  await db.insert(moments).values(rows);
  return ids;
}

function authed(token: string) {
  return request(app).get(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`);
}

describe('GET /api/chains/:chainId/moments（复合游标分页）', () => {
  it('viewer 可读；默认每页 20，按 happened_at DESC, id DESC；返回 nextCursor', async () => {
    await insertFlatMoments();
    const res = await authed(carol.token);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeTruthy();

    // 顺序与 SQL 全量排序一致（防止依赖插入顺序）
    const all = await db
      .select({ id: moments.id })
      .from(moments)
      .orderBy(desc(moments.happenedAt), desc(moments.id));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(
      all.slice(0, 20).map((r) => r.id)
    );
  });

  it('同 happened_at 时间戳跨页不丢不重（limit=7 翻完整 25 条）', async () => {
    const inserted = await insertFlatMoments();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await (cursor
        ? authed(carol.token).query({ limit: 7, cursor })
        : authed(carol.token).query({ limit: 7 }));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(7);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(4); // 25 条 / 7 = 3 页整 + 1 页余 4
    expect(new Set(seen).size).toBe(25);
    expect(new Set(seen)).toEqual(new Set(inserted));
  });

  it('响应含 author 摘要与 media（相对 url）；软删 moment 不出现', async () => {
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    storage.headObject.mockResolvedValue({
      size: 1024,
      contentType: 'image/jpeg',
      lastModified: new Date(),
    });
    await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        type: 'media',
        content: '带图',
        happenedAt: '2026-08-15T12:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [presigned.body.mediaId],
      });
    expect(created.status).toBe(201);

    // 另插一条并软删
    const doomed = randomUUID();
    await db.insert(moments).values({
      id: doomed,
      chainId,
      authorId: alice.id,
      type: 'text',
      content: '将删除',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 6)),
      happenedTzOffset: -480,
      deletedAt: new Date(),
    });

    const res = await authed(carol.token);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).not.toContain(doomed);
    const withMedia = res.body.items.find((i: { id: string }) => i.id === created.body.id);
    expect(withMedia.author).toEqual({ id: alice.id, nickname: 'alice' });
    expect(withMedia.media).toHaveLength(1);
    expect(withMedia.media[0].url).toBe(`/api/media/${presigned.body.mediaId}`);
  });

  it('非法 cursor → 400 INVALID_CURSOR；limit 越界 → 400 INVALID_LIMIT；非成员 → 404', async () => {
    expect((await authed(carol.token).query({ cursor: '!!!' })).status).toBe(400);
    expect((await authed(carol.token).query({ limit: '51' })).status).toBe(400);
    expect((await authed(carol.token).query({ limit: '0' })).status).toBe(400);

    const outsider = await createUser(app, 'outsider');
    const res = await authed(outsider.token);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('GET /api/moments/:id', () => {
  it('成员 viewer 可读；非成员 404；软删 410 MOMENT_DELETED', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: alice.id,
      type: 'text',
      content: '详情',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 1)),
      happenedTzOffset: -480,
    });
    expect(
      (await request(app).get(`/api/moments/${id}`).set('Authorization', `Bearer ${carol.token}`)).status
    ).toBe(200);

    const outsider = await createUser(app, 'outsider2');
    expect(
      (await request(app).get(`/api/moments/${id}`).set('Authorization', `Bearer ${outsider.token}`)).status
    ).toBe(404);

    await db.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, id));
    const gone = await request(app)
      .get(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${carol.token}`);
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('MOMENT_DELETED');
  });
});

describe('PATCH /api/moments/:id', () => {
  it('作者可改 content/happenedAt/isBackfill，媒体不可改', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id, // bob 是 editor，但 PATCH 只看作者本人
      type: 'text',
      content: '原内容',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 2)),
      happenedTzOffset: -480,
    });
    const res = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ content: '改后', happenedAt: '2026-08-14T09:30:00+08:00', isBackfill: true });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('改后');
    expect(res.body.happenedAt).toBe('2026-08-14T01:30:00.000Z');
    expect(res.body.isBackfill).toBe(true);

    const mediaPatch = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ mediaIds: ['x'] });
    expect(mediaPatch.status).toBe(400); // dto .strict() 将 mediaIds 作为未知键拒绝（VALIDATION_ERROR）
  });

  it('非作者（含 owner）→ 403 NOT_MOMENT_AUTHOR', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id,
      type: 'text',
      content: 'bob 的',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 3)),
      happenedTzOffset: -480,
    });
    const res = await request(app)
      .patch(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${alice.token}`) // alice 是 owner 但非作者
      .send({ content: '想改别人的' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_MOMENT_AUTHOR');
  });
});

describe('DELETE /api/moments/:id', () => {
  it('作者软删：deleted_at 落库 + outbox(moment.deleted)；随后详情 410', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id,
      type: 'text',
      content: '待删',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 4)),
      happenedTzOffset: -480,
    });
    const res = await request(app)
      .delete(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(204);
    const [row] = await db.select().from(moments).where(eq(moments.id, id));
    expect(row.deletedAt).not.toBeNull();
    const [event] = await db.select().from(outbox);
    expect(event.type).toBe('moment.deleted');
    expect(event.payload).toEqual({ momentId: id, chainId, authorId: bob.id });

    const gone = await request(app)
      .get(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(gone.status).toBe(410);
  });

  it('链 owner 可删他人 moment；非作者且非 owner → 403', async () => {
    const id = randomUUID();
    await db.insert(moments).values({
      id,
      chainId,
      authorId: bob.id,
      type: 'text',
      content: 'bob 的',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 5)),
      happenedTzOffset: -480,
    });
    const denied = await request(app)
      .delete(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${carol.token}`); // viewer 非作者
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/moments/${id}`)
      .set('Authorization', `Bearer ${alice.token}`); // owner
    expect(ok.status).toBe(204);
  });
});

describe('DELETE /api/chains/:id（Phase 3 级联，兑现 Phase 2 事务锚点）', () => {
  it('链内含 moments 时 owner 删链成功：绑定的 media/moments 级联硬删，未绑定 media 与 outbox 不受影响', async () => {
    // 造一条带 media 的 moment（走真实 presign → complete → create 链路）
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'image/jpeg', lastModified: new Date() });
    await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        type: 'media',
        content: '',
        happenedAt: '2026-08-15T12:00:00+08:00',
        happenedTzOffset: -480,
        mediaIds: [presigned.body.mediaId],
      });
    expect(created.status).toBe(201);
    // 无 media 的 text moment（级联必须覆盖无 media 的行）
    await db.insert(moments).values({
      id: randomUUID(),
      chainId,
      authorId: bob.id,
      type: 'text',
      content: '纯文本',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 7)),
      happenedTzOffset: -480,
    });
    // uploader 名下未绑定的 tmp media：不属任何链，不得被级联误删
    const unboundId = randomUUID();
    await db.insert(media).values({
      id: unboundId,
      momentId: null,
      uploaderId: alice.id,
      s3Key: `tmp/${unboundId}.jpeg`,
      mime: 'image/jpeg',
      size: 512,
      status: 'ready',
      storageMeta: {},
    });

    const res = await request(app)
      .delete(`/api/chains/${chainId}`)
      .set('Authorization', `Bearer ${alice.token}`); // owner
    expect(res.status).toBe(204);
    expect(await db.select().from(moments).where(eq(moments.chainId, chainId))).toHaveLength(0);
    const mediaRows = await db.select().from(media);
    expect(mediaRows.map((r) => r.id)).toEqual([unboundId]); // 绑定的已级联删，未绑定的保留
    expect(await db.select().from(chains).where(eq(chains.id, chainId))).toHaveLength(0);
    // 语义声明：删链不补发 moment.deleted、也不清理既有 outbox 行——
    // pending 的 moment.created 由 Phase 5 worker 按链不存在幂等跳过（见「留给后续 Phase 的接缝」）
    const events = await db.select().from(outbox);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.created', status: 'pending' });
  });

  it('链内有 tag 且 moment 已打标时 owner 删链 204：moment_tags 与 tags 一并级联硬删', async () => {
    const tagRes = await request(app)
      .post(`/api/chains/${chainId}/tags`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ name: '周岁' });
    expect(tagRes.status).toBe(201);
    const tagId = tagRes.body.id as string;

    const momentId = randomUUID();
    await db.insert(moments).values({
      id: momentId,
      chainId,
      authorId: alice.id,
      type: 'text',
      content: '打标瞬间',
      happenedAt: new Date(Date.UTC(2026, 7, 15, 8)),
      happenedTzOffset: -480,
    });
    await db.insert(momentTags).values({ momentId, tagId });

    const res = await request(app)
      .delete(`/api/chains/${chainId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(204);
    expect(await db.select().from(momentTags).where(eq(momentTags.momentId, momentId))).toHaveLength(0);
    expect(await db.select().from(tags).where(eq(tags.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(moments).where(eq(moments.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(chains).where(eq(chains.id, chainId))).toHaveLength(0);
  });
});
