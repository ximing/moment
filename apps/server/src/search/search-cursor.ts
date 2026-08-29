import { BadRequestError } from 'routing-controllers';

export interface DistanceCursor {
  d: number;
  i: string;
}

export function encodeDistanceCursor(d: number, i: string): string {
  return Buffer.from(JSON.stringify({ d, i }), 'utf8').toString('base64url');
}

export function decodeDistanceCursor(raw: string): DistanceCursor {
  let parsed: { d?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  if (
    typeof parsed.d !== 'number' ||
    !Number.isFinite(parsed.d) ||
    typeof parsed.i !== 'string' ||
    parsed.i.length === 0
  ) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { d: parsed.d, i: parsed.i };
}
