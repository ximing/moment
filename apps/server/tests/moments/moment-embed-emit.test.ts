import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { media, outbox } from '../../src/db/schema.js';
import { OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
import { createUser } from '../helpers/auth.js';
import { createChainWithMembers } from '../helpers/chain.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { listenLocal } from '../helpers/http-server.js';
import { installMockStorage, type MockStorage } from '../helpers/storage.js';
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

async function readyImage(token: string, mime = 'image/jpeg'): Promise<string> {
  const presigned = await request(app)
    .post('/api/media/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ mime, size: 1024, kind: 'image' });
  storage.headObject.mockResolvedValue({ size: 1024, contentType: mime, lastModified: new Date() });
  await request(app).post(`/api/media/${presigned.body.mediaId}/complete`).set('Authorization', `Bearer ${token}`).send({});
  return presigned.body.mediaId as string;
}

function postMoment(token: string, chainId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/chains/${chainId}/moments`).set('Authorization', `Bearer ${token}`).send(body);
}

async function embedJobs() {
  return db.select().from(outbox).where(eq(outbox.type, OUTBOX_MOMENT_EMBED));
}

describe('create/update emit moment.embed（spec §4.2 / §4.4）', () => {
  it('纯文字：无 pending 可压图 → 同事务 embed {momentId,chainId}', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const res = await postMoment(alice.token, chainId, {
      type: 'text',
      content: '第一次翻身',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(res.status).toBe(201);
    const jobs = await embedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ momentId: res.body.id, chainId });
    expect(jobs[0].status).toBe('pending');
  });

  it('JPEG：pending compress → 不发 embed', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const imageId = await readyImage(alice.token);
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [imageId],
    });
    expect(res.status).toBe(201);
    expect((await db.select().from(media).where(eq(media.id, imageId)))[0].derivedStatus).toBe('pending');
    expect(await embedJobs()).toHaveLength(0);
  });

  it('GIF-only：不 pending，发 embed', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const gifId = await readyImage(alice.token, 'image/gif');
    const res = await postMoment(alice.token, chainId, {
      type: 'media',
      content: '',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
      mediaIds: [gifId],
    });
    expect(res.status).toBe(201);
    expect(await embedJobs()).toHaveLength(1);
  });

  it('PATCH 正文且无 pending → 再发 embed；同内容在 hash 已写前可重复发（偏差 7）', async () => {
    const chainId = await createChainWithMembers(alice.id);
    const created = await postMoment(alice.token, chainId, {
      type: 'text',
      content: '旧',
      happenedAt: '2026-08-29T10:00:00+08:00',
      happenedTzOffset: -480,
    });
    expect(created.status).toBe(201);
    const patched = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: '新正文' });
    expect(patched.status).toBe(200);
    expect(await embedJobs()).toHaveLength(2);
  });
});
