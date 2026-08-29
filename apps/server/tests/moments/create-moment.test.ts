import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = listenLocal(createApp());

let storage: MockStorage;
let alice: { id: string; token: string };
let bob: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
  bob = await createUser(app, 'bob');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

/** 走真实接口造一条 ready 图片 media，返回 mediaId。 */
async function readyImage(token: string, mime = 'image/jpeg', size = 1024): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size, kind: 'image' });
  storage.headObject.mockResolvedValue({ size, contentType: mime, lastModified: new Date() });
  await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  return presigned.body.mediaId as string;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const baseBody = {
  type: 'text' as const,
  content: '第一次翻身',
  happenedAt: '2026-08-15T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('POST /api/chains/:chainId/moments', () => {
  it('text moment：201，落库 + outbox(moment.created)，response 不含预签名', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
    const res = await postMoment(alice.token, chainId, { ...baseBody, isBackfill: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      chainId,
      type: 'text',
      content: '第一次翻身',
      happenedTzOffset: -480,
      isBackfill: true,
      author: { id: alice.id, nickname: 'alice', avatarUrl: null },
      media: [],
    });
    // 服务端把 +08:00 换算为 UTC 存储（spec §5.6）
    expect(res.body.happenedAt).toBe('2026-08-15T02:00:00.000Z');

    const [row] = await db.select().from(moments).where(eq(moments.id, res.body.id));
    expect(row.happenedAt.toISOString()).toBe('2026-08-15T02:00:00.000Z');

    const [event] = await db.select().from(outbox).where(eq(outbox.type, 'moment.created'));
    expect(event).toMatchObject({ type: 'moment.created', status: 'pending' });
    expect(event.payload).toEqual({
      momentId: res.body.id,
      chainId,
      authorId: alice.id,
      isBackfill: true,
    });
  });

  it('viewer 角色发布 → 403 CHAIN_ROLE_INSUFFICIENT', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'viewer' }]);
    const res = await postMoment(bob.token, chainId, { ...baseBody, content: '我只看看' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });

  it('非链成员 → 404 CHAIN_NOT_FOUND', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const res = await postMoment(bob.token, chainId, { ...baseBody, content: '路人' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('media moment：tmp→final copy、绑定 moment_id、sortOrder 按 mediaIds 顺序', async () => {
    const chainId = await createChainWithMembers(alice.id); // owner 角色已覆盖 editor（偏序），且 UNIQUE(chain_id,user_id) 不允许重复插 alice
    const md1 = await readyImage(alice.token);
    const md2 = await readyImage(alice.token);

    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '两连拍',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [md2, md1], // 故意倒序：response 应按 mediaIds 顺序出
    });
    expect(res.status).toBe(201);
    expect(res.body.media.map((m: { id: string; url: string }) => [m.id, m.url])).toEqual([
      [md2, 'https://fake.local/presigned-get'],
      [md1, 'https://fake.local/presigned-get'],
    ]);

    const momentId = res.body.id as string;
    for (const [idx, md] of [md2, md1].entries()) {
      const [row] = await db.select().from(media).where(eq(media.id, md));
      expect(row.momentId).toBe(momentId);
      expect(row.sortOrder).toBe(idx);
      expect(row.s3Key).toBe(`chains/${chainId}/${momentId}/${md}.jpeg`);
    }
    expect(storage.copyObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('引用他人 media → 400 MEDIA_INVALID，moment 不落库', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
    const foreign = await readyImage(bob.token); // bob 上传的
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [foreign],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(await db.select().from(moments)).toHaveLength(0);
  });

  it('引用未 complete（uploading）的 media → 400 MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id); // owner 角色已覆盖 editor（偏序），且 UNIQUE(chain_id,user_id) 不允许重复插 alice
    const presigned = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'image/jpeg', size: 1024, kind: 'image' });
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [presigned.body.mediaId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('type=video 引用图片 mime → 400 MEDIA_INVALID；type=media 宫格允许图/视频混排（spec §1，见 Global Constraints）', async () => {
    const chainId = await createChainWithMembers(alice.id); // owner 角色已覆盖 editor（偏序），且 UNIQUE(chain_id,user_id) 不允许重复插 alice
    const imageMediaId = await readyImage(alice.token, 'image/png');
    // 直插一条 ready 的 video mime 媒体（multipart 通道造数成本高，归属校验只看行字段）
    const { randomUUID } = await import('node:crypto');
    const videoMediaId = randomUUID();
    await db.insert(media).values({
      id: videoMediaId,
      momentId: null,
      uploaderId: alice.id,
      s3Key: `tmp/${videoMediaId}.mp4`,
      mime: 'video/mp4',
      size: 1024,
      status: 'ready',
      storageMeta: {},
    });

    // type=video 恰好 1 条且必须是 video/*：引用图片 mime → 400，moment 不落库
    const bad = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageMediaId],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MEDIA_INVALID');
    expect(await db.select().from(moments)).toHaveLength(0);

    // type=media 宫格混排图+视频 → 201（spec §1 字面语义，不收紧为「仅图片」）
    const mixed = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-15T11:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageMediaId, videoMediaId],
    });
    expect(mixed.status).toBe(201);
    expect(mixed.body.media.map((m: { id: string }) => m.id)).toEqual([imageMediaId, videoMediaId]);
  });

  it('dto 校验：type=text 携带 mediaIds → 400 VALIDATION_ERROR', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const res = await postMoment(alice.token, chainId, {
      ...baseBody,
      mediaIds: ['whatever'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
