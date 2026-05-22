import { BadRequestError } from 'routing-controllers';

/** 评论游标：base64url(JSON {t: <createdAt epochMs>, i: <commentId>})，语义「(created_at,id) 严格晚于」 */
export function encodeCommentCursor(t: number, i: string): string {
  return Buffer.from(JSON.stringify({ t, i }), 'utf8').toString('base64url');
}

export function decodeCommentCursor(raw: string): { t: number; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const p = parsed as { t?: unknown; i?: unknown };
  if (typeof p.t !== 'number' || !Number.isSafeInteger(p.t) || typeof p.i !== 'string' || p.i.length === 0) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { t: p.t, i: p.i };
}
