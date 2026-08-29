import { randomUUID } from 'node:crypto';
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
import { handleMomentDeleted } from '../../src/worker/handlers.js';
import { MockPushService } from '../../src/push/mock.js';

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

/** 走真实接口造一条 ready media（image 或 audio），返回 mediaId。 */
async function readyMedia(token: string, mime: string, kind: 'image' | 'audio'): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size: 1024, kind, ...(kind === 'audio' ? { durationSeconds: 12 } : {}) });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: mime, lastModified: new Date() });
  await request(app)
    .post(`/api/media/${presigned.body.mediaId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  return presigned.body.mediaId as string;
}

/** 直插 ready 视频行（multipart 造数成本高，同 moment-poster.test.ts 模式）。 */
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

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/chains/${chainId}/moments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const voiceBody = (mediaIds: string[], extra: Record<string, unknown> = {}) => ({
  type: 'voice' as const,
  content: '',
  happenedAt: '2026-08-23T10:00:00+08:00',
  happenedTzOffset: -480,
  mediaIds,
  ...extra,
});

async function setup() {
  const chainId = await createChainWithMembers(alice.id, [{ userId: bob.id, role: 'editor' }]);
  return { chainId };
}

describe('POST moments type=voice（spec voice-moment §3.2/§3.3）', () => {
  it('成功：1 audio + 2 图，空 content；transcriptionStatus=pending；同事务 outbox 含 created/extract/transcribe + 每张可压图 compress', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const img1 = await readyMedia(alice.token, 'image/jpeg', 'image');
    const img2 = await readyMedia(alice.token, 'image/png', 'image');
    const res = await postMoment(alice.token, chainId, voiceBody([audioId, img1, img2]));
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('voice');
    expect(res.body.transcript).toBeNull();
    expect(res.body.transcriptionStatus).toBe('pending');
    expect(res.body.media).toHaveLength(3);
    expect(res.body.media[0]).toMatchObject({ id: audioId, mime: 'audio/wav', duration: 12, sortOrder: 0 });

    const [row] = await db.select().from(moments).where(eq(moments.id, res.body.id));
    expect(row.transcriptionStatus).toBe('pending');
    expect(row.transcript).toBeNull();

    const events = await db.select().from(outbox);
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.type).sort()).toEqual([
      'moment.compress',
      'moment.compress',
      'moment.created',
      'moment.extract',
      'moment.transcribe',
    ]);
    const compressMediaIds = events
      .filter((e) => e.type === 'moment.compress')
      .map((e) => (e.payload as { mediaId: string }).mediaId)
      .sort();
    expect(compressMediaIds).toEqual([img1, img2].sort());
    const transcribe = events.find((e) => e.type === 'moment.transcribe')!;
    expect(transcribe.payload).toEqual({ momentId: res.body.id });

    expect(storage.copyObject).toHaveBeenCalledWith(
      `tmp/${audioId}.wav`,
      `chains/${chainId}/${res.body.id}/${audioId}.wav`,
      expect.anything()
    );
    expect(storage.deleteFile).toHaveBeenCalledWith(`tmp/${audioId}.wav`, expect.anything());
  });

  it('成功：仅 audio 无附图（0~8 图的下界）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/mp4', 'audio');
    const res = await postMoment(alice.token, chainId, voiceBody([audioId]));
    expect(res.status).toBe(201);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0].mime).toBe('audio/mp4');
  });

  it('2 条 audio → 400 MEDIA_INVALID（恰好 1 条 audio/*）', async () => {
    const { chainId } = await setup();
    const a1 = await readyMedia(alice.token, 'audio/wav', 'audio');
    const a2 = await readyMedia(alice.token, 'audio/wav', 'audio');
    const res = await postMoment(alice.token, chainId, voiceBody([a1, a2]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('纯图无 audio → 400 MEDIA_INVALID', async () => {
    const { chainId } = await setup();
    const img = await readyMedia(alice.token, 'image/jpeg', 'image');
    const res = await postMoment(alice.token, chainId, voiceBody([img]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('audio + video 附图 → 400 MEDIA_INVALID（voice 显式拒绝 video/*，spec §3.2）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const videoId = await insertReadyVideo(alice.id);
    const res = await postMoment(alice.token, chainId, voiceBody([audioId, videoId]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('media 宫格夹带 audio → 400 MEDIA_INVALID（else 分支不放行 audio/*）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-23T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [audioId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
  });

  it('dto：voice mediaIds 空 → 400 VALIDATION_ERROR；传 posterMediaId → 400 VALIDATION_ERROR', async () => {
    const { chainId } = await setup();
    const empty = await postMoment(alice.token, chainId, voiceBody([]));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const poster = await postMoment(alice.token, chainId, voiceBody([audioId], { posterMediaId: audioId }));
    expect(poster.status).toBe(400);
    expect(poster.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH 传 transcript → 400 VALIDATION_ERROR（.strict()，转写不可经 API 改）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const created = await postMoment(alice.token, chainId, voiceBody([audioId]));
    expect(created.status).toBe(201);
    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ transcript: '手动改原文' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('非 voice 序列化：text moment 的 transcript / transcriptionStatus 恒 null', async () => {
    const { chainId } = await setup();
    const res = await postMoment(alice.token, chainId, {
      type: 'text',
      content: 'hi',
      happenedAt: '2026-08-23T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(res.status).toBe(201);
    expect(res.body.transcript).toBeNull();
    expect(res.body.transcriptionStatus).toBeNull();
  });

  it('软删带 audio 的 voice moment：handleMomentDeleted 后 audio 行 orphaned（既有路径覆盖，spec §3.5）', async () => {
    const { chainId } = await setup();
    const audioId = await readyMedia(alice.token, 'audio/wav', 'audio');
    const created = await postMoment(alice.token, chainId, voiceBody([audioId]));
    expect(created.status).toBe(201);
    await request(app)
      .delete(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    await handleMomentDeleted(
      { momentId: created.body.id, chainId, authorId: alice.id },
      { push: new MockPushService() }
    );
    const [audioRow] = await db.select().from(media).where(eq(media.id, audioId));
    expect(audioRow.status).toBe('orphaned');
  });
});
