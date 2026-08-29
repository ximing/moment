import { BadRequestError } from 'routing-controllers';
import { decodeCursor, encodeCursor } from '../../src/feed/cursor.js';
import { decodeDistanceCursor, encodeDistanceCursor } from '../../src/search/search-cursor.js';

describe('search-cursor {d,i}（spec §5）', () => {
  it('往返；d 保持浮点原样', () => {
    const raw = encodeDistanceCursor(0.125, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(decodeDistanceCursor(raw)).toEqual({ d: 0.125, i: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { d: unknown; i: unknown; h?: unknown };
    expect(payload).toEqual({ d: 0.125, i: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(payload.h).toBeUndefined();
  });

  it('坏串 / 非有限 d / 空 i → INVALID_CURSOR', () => {
    const bad = (raw: string) => {
      try {
        decodeDistanceCursor(raw);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).message).toBe('INVALID_CURSOR');
      }
    };
    bad('!!!not-base64!!!');
    bad(Buffer.from(JSON.stringify({ d: Number.NaN, i: 'x' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ d: Number.POSITIVE_INFINITY, i: 'x' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ d: 1, i: '' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ d: '1', i: 'x' }), 'utf8').toString('base64url'));
    bad(Buffer.from(JSON.stringify({ h: 1, i: 'x' }), 'utf8').toString('base64url'));
  });

  it('不冒充 feed {h,i}：距离游标 decodeCursor 失败；时间游标 decodeDistanceCursor 失败', () => {
    const hi = encodeCursor('happened_at', Date.parse('2026-08-10T00:00:00Z'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(decodeCursor('happened_at', hi)).toMatchObject({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(() => decodeDistanceCursor(hi)).toThrow(BadRequestError);

    const di = encodeDistanceCursor(0.5, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(() => decodeCursor('happened_at', di)).toThrow(BadRequestError);
  });
});
