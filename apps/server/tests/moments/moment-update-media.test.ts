import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EXTRACT, OUTBOX_MOMENT_TRANSCRIBE } from '../../src/outbox/types.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
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

async function readyImage(token: string, mime = 'image/jpeg', size = 1024): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size, kind: 'image' });
  storage.headObject.mockResolvedValue({ size, contentType: mime, lastModified: new Date() });
  await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set('Authorization', `Bearer ${token}`).send({});
  return presigned.body.mediaId as string;
}

async function readyAudio(token: string): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'audio/wav', size: 1024, kind: 'audio', durationSeconds: 12 });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: 'audio/wav', lastModified: new Date() });
  await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set('Authorization', `Bearer ${token}`).send({});
  return presigned.body.mediaId as string;
}

async function insertReadyVideo(uploaderId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: null,
    uploaderId,
    s3Key: `tmp/${id}.mp4`,
    mime: 'video/mp4',
    size: 1024,
    status: 'ready',
    storageMeta: {},
  });
  return id;
}

async function insertMimeRow(uploaderId: string, mime: string, status: 'ready' | 'uploading' = 'ready'): Promise<string> {
  const id = randomUUID();
  await db.insert(media).values({
    id,
    momentId: null,
    uploaderId,
    s3Key: `tmp/${id}.bin`,
    mime,
    size: 1024,
    status,
    storageMeta: {},
  });
  return id;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`).send(body);
}

function patchMoment(token: string, momentId: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/moments/${momentId}`).set('Authorization', `Bearer ${token}`).send(body);
}

const happened = {
  happenedAt: '2026-08-29T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('PATCH /api/moments/:id mediaIds（spec 2026-08-29-moment-edit-media §4 / §4.6 / §9）', () => {
  it('text + 1 张 JPEG → 200、type=media、tmp→final key、orphan 无', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '纯文字', ...happened });
    const imageId = await readyImage(alice.token);
    const res = await patchMoment(alice.token, text.body.id, { mediaIds: [imageId] });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('media');
    expect(res.body.media.map((m: { id: string }) => m.id)).toEqual([imageId]);
    const [row] = await db.select().from(media).where(eq(media.id, imageId));
    expect(row.momentId).toBe(text.body.id);
    expect(row.status).toBe('ready');
    expect(row.s3Key).toBe(`chains/${chainId}/${text.body.id}/${imageId}.jpeg`);
    expect(row.orphanedAt).toBeNull();
    expect(storage.copyObject).toHaveBeenCalled();
  });

  it('text + [] → 200、type=text（锁后仍是 text）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '纯文字', ...happened });
    const res = await patchMoment(alice.token, text.body.id, { mediaIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('text');
    expect(res.body.media).toEqual([]);
  });

  it('text + 非全部 image（video/pdf）→ 400 MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '纯文字', ...happened });
    const videoId = await insertReadyVideo(alice.id);
    const pdfId = await insertMimeRow(alice.id, 'application/pdf');
    const asVideo = await patchMoment(alice.token, text.body.id, { mediaIds: [videoId] });
    expect(asVideo.status).toBe(400);
    expect(asVideo.body.error.code).toBe('MEDIA_INVALID');
    const asPdf = await patchMoment(alice.token, text.body.id, { mediaIds: [pdfId] });
    expect(asPdf.status).toBe(400);
    expect(asPdf.body.error.code).toBe('MEDIA_INVALID');
    const [m] = await db.select().from(moments).where(eq(moments.id, text.body.id));
    expect(m.type).toBe('text');
  });

  it('media 删到 0 → 400 MEDIA_COUNT_INVALID，原行仍绑着', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [imageId] });
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_COUNT_INVALID');
    const [row] = await db.select().from(media).where(eq(media.id, imageId));
    expect(row.momentId).toBe(created.body.id);
    expect(row.status).toBe('ready');
  });

  it('media 换图：旧行 orphaned + momentId null + orphanedAt 非空；新行绑上；响应顺序 = 提交顺序', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const oldId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [oldId] });
    const newA = await readyImage(alice.token);
    const newB = await readyImage(alice.token);
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [newB, newA] });
    expect(res.status).toBe(200);
    expect(res.body.media.map((m: { id: string }) => m.id)).toEqual([newB, newA]);
    const [oldRow] = await db.select().from(media).where(eq(media.id, oldId));
    expect(oldRow.status).toBe('orphaned');
    expect(oldRow.momentId).toBeNull();
    expect(oldRow.orphanedAt).not.toBeNull();
    expect(oldRow.s3Key).toMatch(/^chains\//); // 不改 s3_key，留给 sweeper
    const [a] = await db.select().from(media).where(eq(media.id, newA));
    const [b] = await db.select().from(media).where(eq(media.id, newB));
    expect(a.momentId).toBe(created.body.id);
    expect(b.momentId).toBe(created.body.id);
    expect(b.sortOrder).toBe(0);
    expect(a.sortOrder).toBe(1);
  });

  it('拖其它 moment 的图 / 非本人 / uploading / pdf → MEDIA_INVALID，目标时刻媒体不变', async () => {
    const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
    const keepId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [keepId] });
    const otherImg = await readyImage(alice.token);
    await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, happenedAt: '2026-08-29T11:00:00+08:00', mediaIds: [otherImg] });
    const bobImg = await readyImage(bob.token);
    const uploading = await insertMimeRow(alice.id, 'image/jpeg', 'uploading');
    const pdf = await insertMimeRow(alice.id, 'application/pdf');
    for (const id of [otherImg, bobImg, uploading, pdf]) {
      const res = await patchMoment(alice.token, created.body.id, { mediaIds: [id] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MEDIA_INVALID');
    }
    const [keep] = await db.select().from(media).where(eq(media.id, keepId));
    expect(keep.momentId).toBe(created.body.id);
    expect(keep.status).toBe('ready');
  });

  it('voice：改附图成功且 audio id 仍在集合中；缺 audio / 换 audio / 其余项非 image → MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const audioId = await readyAudio(alice.token);
    const img1 = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'voice',
      content: '',
      ...happened,
      mediaIds: [audioId, img1],
    });
    const img2 = await readyImage(alice.token);
    const ok = await patchMoment(alice.token, created.body.id, { mediaIds: [audioId, img2] });
    expect(ok.status).toBe(200);
    expect(ok.body.type).toBe('voice');
    expect(ok.body.media.map((m: { id: string }) => m.id).sort()).toEqual([audioId, img2].sort());
    expect(ok.body.media.some((m: { id: string }) => m.id === audioId)).toBe(true);

    const missing = await patchMoment(alice.token, created.body.id, { mediaIds: [img2] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('MEDIA_INVALID');

    const otherAudio = await readyAudio(alice.token);
    const swapped = await patchMoment(alice.token, created.body.id, { mediaIds: [otherAudio, img2] });
    expect(swapped.status).toBe(400);
    expect(swapped.body.error.code).toBe('MEDIA_INVALID');

    const videoId = await insertReadyVideo(alice.id);
    const withVideo = await patchMoment(alice.token, created.body.id, { mediaIds: [audioId, videoId] });
    expect(withVideo.status).toBe(400);
    expect(withVideo.body.error.code).toBe('MEDIA_INVALID');

    const empty = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MEDIA_INVALID');

    const [audioRow] = await db.select().from(media).where(eq(media.id, audioId));
    expect(audioRow.momentId).toBe(created.body.id);
    expect(audioRow.status).toBe('ready');
  });

  it('video + mediaIds（含 []）→ MEDIA_NOT_ALLOWED；视频行与 poster 行未动', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const videoId = await insertReadyVideo(alice.id);
    const posterId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      ...happened,
      mediaIds: [videoId],
      posterMediaId: posterId,
    });
    const [beforeV] = await db.select().from(media).where(eq(media.id, videoId));
    const [beforeP] = await db.select().from(media).where(eq(media.id, posterId));
    const withIds = await patchMoment(alice.token, created.body.id, { mediaIds: [posterId] });
    expect(withIds.status).toBe(400);
    expect(withIds.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const empty = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MEDIA_NOT_ALLOWED');
    const [afterV] = await db.select().from(media).where(eq(media.id, videoId));
    const [afterP] = await db.select().from(media).where(eq(media.id, posterId));
    expect(afterV.momentId).toBe(created.body.id);
    expect(afterP.momentId).toBe(created.body.id);
    expect(afterV.s3Key).toBe(beforeV.s3Key);
    expect(afterP.s3Key).toBe(beforeP.s3Key);
  });

  it('提交 poster id（其它时刻的封面行）→ MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const videoId = await insertReadyVideo(alice.id);
    const posterId = await readyImage(alice.token);
    await postMoment(alice.token, chainId, {
      type: 'video',
      content: '',
      ...happened,
      mediaIds: [videoId],
      posterMediaId: posterId,
    });
    const text = await postMoment(alice.token, chainId, { type: 'text', content: 'x', ...happened, happenedAt: '2026-08-29T12:00:00+08:00' });
    const res = await patchMoment(alice.token, text.body.id, { mediaIds: [posterId] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('并发 tmp 行：同一 tmp 被两个 PATCH 抢，后到 MEDIA_INVALID', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const a = await postMoment(alice.token, chainId, { type: 'text', content: 'A', ...happened });
    const b = await postMoment(alice.token, chainId, { type: 'text', content: 'B', ...happened, happenedAt: '2026-08-29T11:00:00+08:00' });
    const tmp = await readyImage(alice.token);
    const [r1, r2] = await Promise.all([
      patchMoment(alice.token, a.body.id, { mediaIds: [tmp] }),
      patchMoment(alice.token, b.body.id, { mediaIds: [tmp] }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 400]);
    const failed = r1.status === 400 ? r1 : r2;
    expect(failed.body.error.code).toBe('MEDIA_INVALID');
    const [row] = await db.select().from(media).where(eq(media.id, tmp));
    expect(row.momentId === a.body.id || row.momentId === b.body.id).toBe(true);
  });

  it('并发 type：text 同时 PATCH [jpeg] 与 [] → 禁止 type=media 且 0 条内容图', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '并发', ...happened });
    const jpeg = await readyImage(alice.token);
    await Promise.all([
      patchMoment(alice.token, text.body.id, { mediaIds: [jpeg] }),
      patchMoment(alice.token, text.body.id, { mediaIds: [] }),
    ]);
    const [row] = await db.select().from(moments).where(eq(moments.id, text.body.id));
    const bound = await db.select().from(media).where(eq(media.momentId, text.body.id));
    expect(row.type === 'media' && bound.length === 0).toBe(false);
    if (row.type === 'media') {
      expect(bound.some((m) => m.id === jpeg)).toBe(true);
    }
  });

  it('顺序：先 200 升级再 PATCH [] → MEDIA_COUNT_INVALID 且 jpeg 仍绑定', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const text = await postMoment(alice.token, chainId, { type: 'text', content: '升级', ...happened });
    const jpeg = await readyImage(alice.token);
    const up = await patchMoment(alice.token, text.body.id, { mediaIds: [jpeg] });
    expect(up.status).toBe(200);
    expect(up.body.type).toBe('media');
    const empty = await patchMoment(alice.token, text.body.id, { mediaIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('MEDIA_COUNT_INVALID');
    const [row] = await db.select().from(media).where(eq(media.id, jpeg));
    expect(row.momentId).toBe(text.body.id);
    expect(row.status).toBe('ready');
  });

  it('GIF/HEIC/HEIF 新进：不 compress、derived_status NULL', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const mimes = ['image/gif', 'image/heic', 'image/heif'] as const;
    for (let i = 0; i < mimes.length; i++) {
      const mime = mimes[i]!;
      const text = await postMoment(alice.token, chainId, {
        type: 'text',
        content: mime,
        ...happened,
        happenedAt: `2026-08-29T1${i}:00:00+08:00`,
      });
      const id = await readyImage(alice.token, mime);
      const res = await patchMoment(alice.token, text.body.id, { mediaIds: [id] });
      expect(res.status).toBe(200);
      expect((await db.select().from(media).where(eq(media.id, id)))[0].derivedStatus).toBeNull();
      const jobs = await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_COMPRESS));
      expect(jobs.filter((j) => (j.payload as { mediaId: string }).mediaId === id)).toHaveLength(0);
    }
  });

  it('只改 mediaIds 不改正文 → 不因媒体变化多发 moment.extract；voice 不重发 transcribe', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const audioId = await readyAudio(alice.token);
    const img1 = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, {
      type: 'voice',
      content: '',
      ...happened,
      mediaIds: [audioId, img1],
    });
    // 模拟 extract worker 已消费：hash 已写。create 后 hash 仍 NULL 时，现网任意成功 PATCH
    // 都会再发一行 extract（moment.service 注释「重复 PATCH 同内容在消费前会重复发射」）。
    // 不先写 hash，本断言会在正确实现上假红，误导去改 extract 发射条件。
    await db
      .update(moments)
      .set({ aiExtractHash: computeAiExtractHash('', null) })
      .where(eq(moments.id, created.body.id));
    const extractBefore = (await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EXTRACT))).length;
    const transcribeBefore = (await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_TRANSCRIBE))).length;
    const img2 = await readyImage(alice.token);
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [audioId, img2] });
    expect(res.status).toBe(200);
    expect((await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EXTRACT))).length).toBe(extractBefore);
    expect((await db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_TRANSCRIBE))).length).toBe(transcribeBefore);
  });

  it('矩阵失败零 copy：media [] 不调用 copyObject', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const created = await postMoment(alice.token, chainId, { type: 'media', content: '', ...happened, mediaIds: [imageId] });
    storage.copyObject.mockClear();
    const res = await patchMoment(alice.token, created.body.id, { mediaIds: [] });
    expect(res.status).toBe(400);
    expect(storage.copyObject).not.toHaveBeenCalled();
  });
});
