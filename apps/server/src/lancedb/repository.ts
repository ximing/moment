import { logger } from '../utils/logger.js';
import { getLanceTable } from './factory.js';
import { lanceEqUuid, vectorRowId } from './ids.js';

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
