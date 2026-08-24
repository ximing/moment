import request from 'supertest';
import { eq } from 'drizzle-orm';
import { MAX_AUDIO_BYTES } from '@moment/dto';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media } from '../../src/db/schema.js';
import { createUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
import { listenLocal } from '../helpers/http-server.js';
import { setStorageAdapter } from '../../src/storage/factory.js';

const app = listenLocal(createApp());

let storage: MockStorage;
let alice: { id: string; token: string };

beforeEach(async () => {
  await resetDb();
  storage = installMockStorage();
  alice = await createUser(app, 'alice');
});

afterEach(() => setStorageAdapter(null));
afterAll(closeDb);

async function presignAudio(token: string, over: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime: 'audio/wav', size: 1024, kind: 'audio', durationSeconds: 12, ...over });
}

describe('POST /api/media/presign（audio，spec voice-moment §3.1）', () => {
  it('audio：单 PUT（method=put），duration 落库，不启 multipart', async () => {
    const res = await presignAudio(alice.token);
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('put');
    expect(res.body.url).toBe('https://fake.local/presigned-put');
    expect(res.body.uploadId).toBeNull();
    expect(res.body.partSize).toBeNull();

    const [row] = await db.select().from(media).where(eq(media.id, res.body.mediaId));
    expect(row).toMatchObject({ mime: 'audio/wav', status: 'uploading', duration: 12, uploadId: null });
    expect(row.s3Key).toBe(`tmp/${res.body.mediaId}.wav`);
    expect(storage.initMultipart).not.toHaveBeenCalled();
  });

  it('audio 超 25MB → 413 MEDIA_TOO_LARGE，且不插行', async () => {
    const res = await presignAudio(alice.token, { size: MAX_AUDIO_BYTES + 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('MEDIA_TOO_LARGE');
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it('audio 缺 durationSeconds → 400 VALIDATION_ERROR（dto superRefine）', async () => {
    const res = await request(app)
      .post('/api/media/presign')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ mime: 'audio/wav', size: 1024, kind: 'audio' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audio 非白名单 mime（audio/webm）→ 400 VALIDATION_ERROR', async () => {
    const res = await presignAudio(alice.token, { mime: 'audio/webm' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audio complete → ready（complete 按行工作，对 audio 零改动，spec §3.1）', async () => {
    const presigned = await presignAudio(alice.token);
    storage.headObject.mockResolvedValue({ size: 1024, contentType: 'audio/wav', lastModified: new Date() });
    const res = await request(app)
      .post(`/api/media/${presigned.body.mediaId}/complete`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mediaId: presigned.body.mediaId, status: 'ready', mime: 'audio/wav', size: 1024 });
    const [row] = await db.select().from(media).where(eq(media.id, presigned.body.mediaId));
    expect(row.status).toBe('ready');
  });
});
