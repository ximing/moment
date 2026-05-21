import { BadRequestError } from 'routing-controllers';

export type MomentOrder = 'happened_at' | 'created_at';

export interface DecodedCursor {
  /** epoch ms */
  time: number;
  id: string;
}

/**
 * CONVENTIONS §3.4：游标 = base64url(JSON)。
 * order=happened_at → {h: epochMs, i: momentId}；order=created_at → {c: epochMs, i: momentId}。
 */
export function encodeCursor(order: MomentOrder, time: number, id: string): string {
  const payload = order === 'happened_at' ? { h: time, i: id } : { c: time, i: id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(order: MomentOrder, raw: string): DecodedCursor {
  let parsed: { h?: unknown; c?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const time = order === 'happened_at' ? parsed.h : parsed.c;
  if (
    typeof time !== 'number' ||
    !Number.isInteger(time) ||
    !Number.isSafeInteger(time) ||
    typeof parsed.i !== 'string' ||
    parsed.i.length === 0
  ) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { time, id: parsed.i };
}
