import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { media, momentPersons, moments, persons } from '../db/schema.js';
import { isCompressibleMime } from '../media/derived.js';
import { emitOutbox, type DbTx } from '../outbox/outbox.js';
import { OUTBOX_MOMENT_EMBED } from '../outbox/types.js';
import { computeEmbedHash, derivedFingerprintOf } from './embed-hash.js';

export async function maybeEmitMomentEmbed(tx: DbTx, momentId: string): Promise<void> {
  const [m] = await tx.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  const mediaRows = await tx.select().from(media).where(eq(media.momentId, momentId));
  const pending = mediaRows.some((r) => isCompressibleMime(r.mime) && r.derivedStatus === 'pending');
  if (pending) return;

  const personRows = await tx
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

  await emitOutbox(tx, OUTBOX_MOMENT_EMBED, { momentId, chainId: m.chainId });
}
