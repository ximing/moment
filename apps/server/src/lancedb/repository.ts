import { logger } from '../utils/logger.js';
import { getLanceTable } from './factory.js';
import { LANCE_UUID_RE, lanceEqUuid, lanceInUuids, vectorRowId } from './ids.js';

export type MomentVectorKind = 'moment' | 'image';

export interface MomentVectorRow {
  id: string;
  momentId: string;
  chainId: string;
  kind: MomentVectorKind;
  mediaId: string;
  vector: number[];
  modelHash: string;
}

export interface MomentVectorInput {
  momentId: string;
  chainId: string;
  kind: MomentVectorKind;
  mediaId?: string;
  vector: number[];
  modelHash: string;
}

function toRow(input: MomentVectorInput): MomentVectorRow {
  if (input.kind === 'image' && !input.mediaId) {
    throw new Error('VALIDATION_ERROR');
  }
  const mediaId = input.kind === 'image' ? (input.mediaId as string) : '';
  return {
    id: vectorRowId(input.kind, input.momentId, mediaId),
    momentId: input.momentId,
    chainId: input.chainId,
    kind: input.kind,
    mediaId,
    vector: Array.from(input.vector),
    modelHash: input.modelHash,
  };
}

export async function upsertMomentVector(input: MomentVectorInput): Promise<void> {
  const row = toRow(input);
  const table = getLanceTable();
  await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([{ ...row }]);
}

export async function listVectorsByMomentId(momentId: string): Promise<MomentVectorRow[]> {
  const pred = lanceEqUuid('momentId', momentId);
  if (!pred) return [];
  const table = getLanceTable();
  const q = table as unknown as { query: () => { where: (p: string) => { toArray: () => Promise<unknown[]> } } };
  const raw = await q.query().where(pred).toArray();
  return raw as MomentVectorRow[];
}

export async function deleteVectorsByMomentId(momentId: string): Promise<number> {
  const pred = lanceEqUuid('momentId', momentId);
  if (!pred) {
    logger.warn('lancedb delete ignored non-uuid momentId');
    return 0;
  }
  const existing = await listVectorsByMomentId(momentId);
  const n = existing.length;
  if (n === 0) return 0;
  await getLanceTable().delete(pred);
  return n;
}

export async function listVectorsByChainId(chainId: string): Promise<MomentVectorRow[]> {
  const pred = lanceEqUuid('chainId', chainId);
  if (!pred) return [];
  const table = getLanceTable();
  const q = table as unknown as { query: () => { where: (p: string) => { toArray: () => Promise<unknown[]> } } };
  const raw = await q.query().where(pred).toArray();
  return raw as MomentVectorRow[];
}

export async function deleteVectorsByChainId(chainId: string): Promise<number> {
  const pred = lanceEqUuid('chainId', chainId);
  if (!pred) {
    logger.warn('lancedb delete ignored non-uuid chainId');
    return 0;
  }
  const existing = await listVectorsByChainId(chainId);
  const n = existing.length;
  if (n === 0) return 0;
  await getLanceTable().delete(pred);
  return n;
}

export interface VectorNeighbor {
  momentId: string;
  chainId: string;
  kind: MomentVectorKind;
  mediaId: string;
  modelHash: string;
  distance: number;
}

export async function searchMomentVectors(opts: {
  vector: number[];
  chainIds: string[];
  momentIds?: string[];
  limit: number;
}): Promise<VectorNeighbor[]> {
  if (opts.chainIds.length === 0) return [];
  const chainPred = lanceInUuids('chainId', opts.chainIds);
  if (!chainPred) {
    if (opts.chainIds.length > 0) logger.warn('lancedb search dropped non-uuid chainIds');
    return [];
  }
  if (opts.chainIds.some((id) => !LANCE_UUID_RE.test(id))) {
    logger.warn('lancedb search dropped non-uuid chainIds');
  }
  let pred = chainPred;
  if (opts.momentIds) {
    if (opts.momentIds.some((id) => !LANCE_UUID_RE.test(id))) {
      logger.warn('lancedb search dropped non-uuid momentIds');
    }
    const momentPred = lanceInUuids('momentId', opts.momentIds);
    if (!momentPred) return [];
    pred = `${chainPred} AND ${momentPred}`;
  }

  let raw: Record<string, unknown>[] = [];
  try {
    const table = getLanceTable() as unknown as {
      search: (vector: number[]) => {
        limit: (n: number) => { where: (p: string) => { toArray: () => Promise<Record<string, unknown>[]> } };
      };
    };
    raw = await table.search(opts.vector).limit(opts.limit).where(pred).toArray();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/search is not a function|is not a function/.test(msg)) {
      throw new Error(
        `LANCE_SEARCH_API: getLanceTable().search(vector).limit().where().toArray() failed: ${msg}`,
      );
    }
    throw err;
  }

  const out: VectorNeighbor[] = [];
  for (const row of raw) {
    const distance = row._distance;
    if (typeof distance !== 'number' || !Number.isFinite(distance)) {
      logger.warn('search vector row missing finite _distance');
      continue;
    }
    if (typeof row.momentId !== 'string' || typeof row.chainId !== 'string') continue;
    out.push({
      momentId: row.momentId,
      chainId: row.chainId,
      kind: row.kind === 'image' ? 'image' : 'moment',
      mediaId: typeof row.mediaId === 'string' ? row.mediaId : '',
      modelHash: typeof row.modelHash === 'string' ? row.modelHash : '',
      distance,
    });
  }
  return out;
}
