import { createHash } from 'node:crypto';
import { isCompressibleMime } from '../media/derived.js';

export interface EmbedHashInput {
  content: string;
  transcript: string | null;
  personNames: string[];
  placeName: string | null;
  derivedFingerprint: string;
  model: string;
  dim: number;
}

export function computeEmbedHash(input: EmbedHashInput): string {
  const names = [...input.personNames].sort().join('\n');
  const raw = `${input.content}\0${input.transcript ?? ''}\0${names}\0${input.placeName ?? ''}\0${input.derivedFingerprint}\0${input.model}:${input.dim}`;
  return createHash('sha256').update(raw).digest('hex');
}

export function derivedFingerprintOf(
  rows: Array<{
    id: string;
    mime: string;
    sortOrder: number;
    derivedStatus: string | null;
    derivedS3Key: string | null;
  }>,
): string {
  return rows
    .filter((r) => isCompressibleMime(r.mime))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((r) => `${r.id}:${r.derivedStatus ?? 'null'}:${r.derivedS3Key ?? '-'}`)
    .join('\n');
}

export function assembleEmbedText(
  content: string,
  transcript: string | null,
  personNames: string[],
  placeName: string | null,
): string {
  return [content, transcript ?? '', [...personNames].sort((a, b) => a.localeCompare(b, 'zh')).join('\n'), placeName ?? ''].join('\n').trim();
}
