import { BadRequestError } from 'routing-controllers';

/** order=happened_at：{h: epochMs, i: momentId} */
export interface HappenedCursor {
  h: number;
  i: string;
}

/** order=created_at：{c: epochMs, i: momentId}（Phase 4 feed 消费） */
export interface CreatedCursor {
  c: number;
  i: string;
}

export type CursorPayload = HappenedCursor | CreatedCursor;

/** 游标 = base64url(JSON)（CONVENTIONS §3.4，客户端视角为 opaque string） */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** h 与 c 恰好其一 + 非空 i；否则 INVALID_CURSOR。 */
export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const p = parsed as Partial<HappenedCursor & CreatedCursor>;
  const hasH = typeof p.h === 'number';
  const hasC = typeof p.c === 'number';
  if (typeof p.i !== 'string' || p.i.length === 0 || hasH === hasC) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return p as CursorPayload;
}
