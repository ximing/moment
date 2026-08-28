import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('fused-retrieval schema 冒烟（P1：八列，spec §2.1/§2.2/§2.3）', () => {
  it('media 派生六列与 moments.embed_hash、outbox.last_error 默认 NULL', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const mediaId = randomUUID();
    await db.insert(media).values({
      id: mediaId,
      momentId,
      uploaderId: owner.id,
      s3Key: `chains/${chainId}/${momentId}/${mediaId}.jpeg`,
      mime: 'image/jpeg',
      size: 1024,
      status: 'ready',
      storageMeta: {
        bucket: 'moment-test-placeholder',
        prefix: 'test/attachments',
        region: 'us-east-1',
        isPublicBucket: 'false',
      },
    });

    const [row] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(row.derivedS3Key).toBeNull();
    expect(row.derivedMime).toBeNull();
    expect(row.derivedSize).toBeNull();
    expect(row.derivedWidth).toBeNull();
    expect(row.derivedHeight).toBeNull();
    expect(row.derivedStatus).toBeNull();

    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBeNull();
    expect(m.aiExtractHash).toBeNull();

    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.compress',
      payload: { momentId, chainId, mediaId },
      status: 'pending',
    });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.lastError).toBeNull();
  });

  it('派生列 / embed_hash / last_error 可写可读回', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const mediaId = randomUUID();
    await db.insert(media).values({
      id: mediaId,
      momentId,
      uploaderId: owner.id,
      s3Key: `chains/${chainId}/${momentId}/${mediaId}.jpeg`,
      mime: 'image/jpeg',
      size: 2048,
      status: 'ready',
      storageMeta: {
        bucket: 'moment-test-placeholder',
        prefix: 'test/attachments',
        region: 'us-east-1',
        isPublicBucket: 'false',
      },
    });

    await db
      .update(media)
      .set({
        derivedS3Key: `chains/${chainId}/${momentId}/${mediaId}.derived.webp`,
        derivedMime: 'image/webp',
        derivedSize: 800,
        derivedWidth: 512,
        derivedHeight: 384,
        derivedStatus: 'ready',
      })
      .where(eq(media.id, mediaId));
    const [ready] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(ready.derivedMime).toBe('image/webp');
    expect(ready.derivedSize).toBe(800);
    expect(ready.derivedWidth).toBe(512);
    expect(ready.derivedStatus).toBe('ready');

    for (const status of ['pending', 'skipped', 'failed'] as const) {
      await db.update(media).set({ derivedStatus: status }).where(eq(media.id, mediaId));
      const [s] = await db.select().from(media).where(eq(media.id, mediaId));
      expect(s.derivedStatus).toBe(status);
    }

    const hash = 'b'.repeat(64);
    await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.embedHash).toBe(hash);

    const obId = randomUUID();
    await db.insert(outbox).values({
      id: obId,
      type: 'moment.embed',
      payload: { momentId, chainId },
      status: 'failed',
      lastError: 'x'.repeat(512),
    });
    const [ob] = await db.select().from(outbox).where(eq(outbox.id, obId));
    expect(ob.lastError).toHaveLength(512);
    expect(ob.type).toBe('moment.embed');
  });
});
