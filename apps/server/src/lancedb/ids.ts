/** spec fused-retrieval §2.5：拼进 Lance `.where` 的 id 必须先过此正则，否则丢弃并 warn。 */
export const LANCE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lanceEqUuid(column: string, value: string): string | null {
  if (!LANCE_UUID_RE.test(value)) return null;
  return `${column} = '${value}'`;
}

export function lanceInUuids(column: string, ids: string[]): string | null {
  const clean = ids.filter((id) => LANCE_UUID_RE.test(id));
  if (clean.length === 0) return null;
  return `${column} IN (${clean.map((id) => `'${id}'`).join(', ')})`;
}

export function vectorRowId(kind: 'moment' | 'image', momentId: string, mediaId?: string): string {
  return kind === 'image' ? `media:${mediaId ?? ''}` : `moment:${momentId}`;
}
