import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, moments, outbox } from '../../src/db/schema.js';
import type { EmbeddingProvider } from '../../src/embedding/base.provider.js';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../../src/outbox/types.js';
import { emitOutbox } from '../../src/outbox/outbox.js';
import { runEmbedBackfillSweep, EMBED_BACKFILL_DEFAULT_BATCH } from '../../src/worker/embed-backfill.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const TEST_META = {
  bucket: 'moment-test-placeholder',
  prefix: 'test/attachments',
  region: 'us-east-1',
  isPublicBucket: 'false' as const,
};

beforeEach(async () => {
  await resetDb();
  setEmbeddingProvider({} as unknown as EmbeddingProvider);
});
afterEach(() => setEmbeddingProvider(undefined));
afterAll(closeDb);

async function addMedia(opts: {
  momentId: string;
  chainId: string;
  ownerId: string;
  mime?: string;
  derivedStatus?: 'pending' | 'ready' | 'skipped' | 'failed' | null;
  status?: 'ready' | 'uploading';
}): Promise<string> {
  const mediaId = randomUUID();
  await db.insert(media).values({
    id: mediaId,
    momentId: opts.momentId,
    uploaderId: opts.ownerId,
    s3Key: `chains/${opts.chainId}/${opts.momentId}/${mediaId}.jpeg`,
    mime: opts.mime ?? 'image/jpeg',
    size: 2048,
    status: opts.status ?? 'ready',
    storageMeta: TEST_META,
    sortOrder: 0,
    derivedStatus: opts.derivedStatus === undefined ? null : opts.derivedStatus,
  });
  return mediaId;
}

async function rowsOf(type: typeof OUTBOX_MOMENT_COMPRESS | typeof OUTBOX_MOMENT_EMBED) {
  return db.select().from(outbox).where(eq(outbox.type, type));
}

describe('runEmbedBackfillSweep（spec fused-retrieval §11 P10）', () => {
  it('常量 100；package.json script 是 tsx scripts/backfill-embed.ts', () => {
    expect(EMBED_BACKFILL_DEFAULT_BATCH).toBe(100);
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['backfill:embed']).toBe('tsx scripts/backfill-embed.ts');
    expect(pkg.scripts.test).toContain('--runInBand');
  });

  it('换模型操作注释锁定：LANCEDB_PATH + UPDATE embed_hash NULL；无 --reset-hash', () => {
    const src = readFileSync(path.join(SERVER_ROOT, 'scripts/backfill-embed.ts'), 'utf8');
    expect(src).toContain('LANCEDB_PATH');
    expect(src).toContain('UPDATE moments SET embed_hash = NULL WHERE deleted_at IS NULL');
    expect(src).toContain('--batch');
    expect(src).toContain('--interval-ms');
    expect(src).not.toContain('--reset-hash');
    const worker = readFileSync(path.join(SERVER_ROOT, 'src/worker/index.ts'), 'utf8');
    expect(worker).not.toContain('embed-backfill');
    const impl = readFileSync(path.join(SERVER_ROOT, 'src/worker/embed-backfill.ts'), 'utf8');
    expect(impl).not.toContain('lancedb');
    expect(impl).not.toContain('@lancedb/lancedb');
  });

  it('phase1：3 张 NULL 派生 JPEG、batchSize=2 → compressDispatched=3，列变 pending，payload 含 mediaId；phase2 因 pending 图不发 embed', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date('2026-08-01T00:00:00Z'),
      content: '三连拍',
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await addMedia({ momentId, chainId, ownerId: owner.id }));
    }

    const result = await runEmbedBackfillSweep({ batchSize: 2, pauseMs: 0 });
    expect(result.compressDispatched).toBe(3);
    expect(result.embedDispatched).toBe(0);

    const compress = await rowsOf(OUTBOX_MOMENT_COMPRESS);
    expect(compress).toHaveLength(3);
    const payloadIds = compress.map((r) => (r.payload as { mediaId: string }).mediaId).sort();
    expect(payloadIds).toEqual([...ids].sort());
    expect(compress.every((r) => (r.payload as { momentId: string; chainId: string }).momentId === momentId)).toBe(
      true,
    );
    expect(compress.every((r) => (r.payload as { chainId: string }).chainId === chainId)).toBe(true);

    for (const id of ids) {
      const [row] = await db.select().from(media).where(eq(media.id, id));
      expect(row.derivedStatus).toBe('pending');
      expect(row.derivedS3Key).toBeNull();
    }
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(0);
  });

  it('GIF/HEIC/HEIF/视频/uploading/软删不 compress；非可压时刻无 pending 可压图且有正文 → 只 embed', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const skipIds: string[] = [];
    for (const mime of ['image/gif', 'image/heic', 'image/heif'] as const) {
      const momentId = await insertMoment({
        chainId,
        authorId: owner.id,
        happenedAt: new Date(),
        content: mime,
      });
      await addMedia({ momentId, chainId, ownerId: owner.id, mime });
      skipIds.push(momentId);
    }
    const videoM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: 'video',
    });
    await addMedia({ momentId: videoM, chainId, ownerId: owner.id, mime: 'video/mp4' });
    const uploadingM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: 'uploading',
    });
    await addMedia({
      momentId: uploadingM,
      chainId,
      ownerId: owner.id,
      status: 'uploading',
    });
    const deleted = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已删',
      deletedAt: new Date(),
    });
    await addMedia({ momentId: deleted, chainId, ownerId: owner.id });

    const result = await runEmbedBackfillSweep();
    expect(result.compressDispatched).toBe(0);
    expect((await rowsOf(OUTBOX_MOMENT_COMPRESS)).length).toBe(0);

    const embedPayloads = (await rowsOf(OUTBOX_MOMENT_EMBED)).map(
      (r) => (r.payload as { momentId: string }).momentId,
    );
    expect(embedPayloads).toEqual(expect.arrayContaining([...skipIds, videoM, uploadingM]));
    expect(embedPayloads).not.toContain(deleted);
    expect(result.embedDispatched).toBe(5);

    const [gifRow] = await db.select().from(media).where(eq(media.momentId, skipIds[0]));
    expect(gifRow.derivedStatus).toBeNull();
  });

  it('ready 图 + embed_hash NULL → 不 compress，发 1 条 embed；已有 hash 不发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const readyM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已压',
    });
    await addMedia({ momentId: readyM, chainId, ownerId: owner.id, derivedStatus: 'ready' });
    const hashed = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已嵌',
    });
    await db.update(moments).set({ embedHash: 'a'.repeat(64) }).where(eq(moments.id, hashed));

    const result = await runEmbedBackfillSweep();
    expect(result.compressDispatched).toBe(0);
    expect(result.embedDispatched).toBe(1);
    const [row] = await rowsOf(OUTBOX_MOMENT_EMBED);
    expect(row.payload).toEqual({ momentId: readyM, chainId });
  });

  it('failed 派生不阻塞 embed（无 pending）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '坏图仍有正文',
    });
    await addMedia({ momentId, chainId, ownerId: owner.id, derivedStatus: 'failed' });
    const result = await runEmbedBackfillSweep();
    expect(result.compressDispatched).toBe(0);
    expect(result.embedDispatched).toBe(1);
  });

  it('空素材（空正文、无 ready 图）不发 embed——防跨 run 重复派发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '',
    });
    const result = await runEmbedBackfillSweep();
    expect(result).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(0);
  });

  it('纯文字 hash NULL → 只 embed；pending compress/embed 去重', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const textId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '纯文字存量',
    });
    const first = await runEmbedBackfillSweep();
    expect(first).toEqual({ compressDispatched: 0, embedDispatched: 1 });
    const [textRow] = await rowsOf(OUTBOX_MOMENT_EMBED);
    expect(textRow.payload).toEqual({ momentId: textId, chainId });
    const second = await runEmbedBackfillSweep();
    expect(second).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(1);

    const jpegM = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '待压',
    });
    const mediaId = await addMedia({ momentId: jpegM, chainId, ownerId: owner.id });
    await db.transaction(async (tx) => {
      await emitOutbox(tx, OUTBOX_MOMENT_COMPRESS, { momentId: jpegM, chainId, mediaId });
    });
    const third = await runEmbedBackfillSweep();
    expect(third).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(
      (await rowsOf(OUTBOX_MOMENT_COMPRESS)).filter((r) => (r.payload as { mediaId: string }).mediaId === mediaId),
    ).toHaveLength(1);
    const [jpegRow] = await db.select().from(media).where(eq(media.id, mediaId));
    expect(jpegRow.derivedStatus).toBeNull();
  });

  it('空 provider（null）→ 直接退出，不写 outbox', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '有素材',
    });
    await addMedia({ momentId, chainId, ownerId: owner.id });
    setEmbeddingProvider(null);
    const result = await runEmbedBackfillSweep();
    expect(result).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_COMPRESS)).toHaveLength(0);
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(0);
  });

  it('消费后二跑幂等：phase1 pending 图被 mock 成 ready 后 phase2 才能 embed；写 hash 后 dispatched=0', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '存量图',
    });
    const mediaId = await addMedia({ momentId, chainId, ownerId: owner.id });

    const first = await runEmbedBackfillSweep();
    expect(first.compressDispatched).toBe(1);
    expect(first.embedDispatched).toBe(0);

    await db
      .update(media)
      .set({
        derivedStatus: 'ready',
        derivedS3Key: `chains/${chainId}/${momentId}/${mediaId}.derived.webp`,
        derivedMime: 'image/webp',
        derivedSize: 100,
        derivedWidth: 512,
        derivedHeight: 256,
      })
      .where(eq(media.id, mediaId));
    await db.update(outbox).set({ status: 'done', processedAt: new Date() }).where(eq(outbox.type, OUTBOX_MOMENT_COMPRESS));

    const second = await runEmbedBackfillSweep();
    expect(second.compressDispatched).toBe(0);
    expect(second.embedDispatched).toBe(1);

    await db.update(moments).set({ embedHash: 'b'.repeat(64) }).where(eq(moments.id, momentId));
    const third = await runEmbedBackfillSweep();
    expect(third).toEqual({ compressDispatched: 0, embedDispatched: 0 });
    expect(await rowsOf(OUTBOX_MOMENT_EMBED)).toHaveLength(1);
    expect(await rowsOf(OUTBOX_MOMENT_COMPRESS)).toHaveLength(1);
  });
});
