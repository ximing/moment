import { MAX_IMAGE_BYTES } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, momentPersons, moments, persons } from '../db/schema.js';
import { compressToEmbedWebp, NonRetryableCompressError } from '../media/compress.js';
import { isCompressibleMime } from '../media/derived.js';
import { assembleEmbedText, computeEmbedHash, derivedFingerprintOf } from '../moments/embed-hash.js';
import { getStorage } from '../storage/factory.js';
import { NonRetryableEmbeddingError } from './base.provider.js';
import { deleteInternalEmbeddings, upsertInternalEmbedding } from './ba-client.js';
import { getEmbeddingProvider } from './factory.js';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function dataUri(buf: Buffer): string {
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

/**
 * moment.embed（spec fused-retrieval §4.3）。
 * 读原图、内存压 1024 WebP 80 发模型；禁止 upload 该 buffer、禁止改 outbox.status、禁止 import lancedb。
 */
export async function handleMomentEmbed(
  payload: Record<string, unknown>,
  _deps?: { push: unknown },
): Promise<void> {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  const provider = getEmbeddingProvider();
  if (!provider) return;

  const mediaRows = await db.select().from(media).where(eq(media.momentId, momentId));
  const personRows = await db
    .select({ name: persons.name })
    .from(momentPersons)
    .innerJoin(persons, eq(momentPersons.personId, persons.id))
    .where(eq(momentPersons.momentId, momentId));
  const personNames = personRows.map((r) => r.name).filter((n) => n.length > 0);

  const hash = computeEmbedHash({
    content: m.content,
    transcript: m.transcript,
    personNames,
    placeName: m.placeName,
    derivedFingerprint: derivedFingerprintOf(mediaRows),
    model: config.MULTIMODAL_EMBEDDING_MODEL,
    dim: config.MULTIMODAL_EMBEDDING_DIMENSION,
  });
  if (hash === m.embedHash) return;

  const text = assembleEmbedText(m.content, m.transcript, personNames, m.placeName);
  const ready = mediaRows
    .filter((r) => isCompressibleMime(r.mime) && r.derivedStatus === 'ready' && r.derivedS3Key)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const images: Array<{ mediaId: string; uri: string }> = [];
  for (const row of ready) {
    try {
      const orig = await getStorage().getObject(row.s3Key, row.storageMeta, MAX_IMAGE_BYTES);
      const out = await compressToEmbedWebp(orig);
      images.push({ mediaId: row.id, uri: dataUri(out.buffer) });
    } catch (err) {
      if (err instanceof Error && err.name === 'ObjectTooLargeError') {
        throw new NonRetryableEmbeddingError('OBJECT_TOO_LARGE', err);
      }
      if (err instanceof NonRetryableCompressError) {
        throw new NonRetryableEmbeddingError(err.message, err);
      }
      throw err;
    }
  }

  await deleteInternalEmbeddings(momentId);

  const first = images[0];
  if (!text && !first) return;

  const modelHash = provider.modelHash();
  if (text && first) {
    const vector = await provider.embed({ text, imageDataUri: first.uri });
    await upsertInternalEmbedding({ momentId, chainId: m.chainId, kind: 'moment', vector, modelHash });
  } else if (text) {
    const vector = await provider.embed({ text });
    await upsertInternalEmbedding({ momentId, chainId: m.chainId, kind: 'moment', vector, modelHash });
  } else if (first) {
    const vector = await provider.embed({ imageDataUri: first.uri });
    await upsertInternalEmbedding({ momentId, chainId: m.chainId, kind: 'moment', vector, modelHash });
  }

  for (const img of images.slice(1)) {
    const vector = await provider.embed({ imageDataUri: img.uri });
    await upsertInternalEmbedding({
      momentId,
      chainId: m.chainId,
      kind: 'image',
      mediaId: img.mediaId,
      vector,
      modelHash,
    });
  }

  await db.update(moments).set({ embedHash: hash }).where(eq(moments.id, momentId));
}
