import { BadRequestError } from 'routing-controllers';
import { decodeCursor, encodeCursor } from '../../src/moments/cursor.js';

describe('moment cursor（CONVENTIONS §3.4）', () => {
  it('happened_at 游标 roundtrip：{h: epochMs, i: momentId}', () => {
    const encoded = encodeCursor({ h: 1755242400000, i: 'm-1' });
    expect(decodeCursor(encoded)).toEqual({ h: 1755242400000, i: 'm-1' });
  });

  it('created_at 游标 roundtrip：{c: epochMs, i: momentId}', () => {
    const encoded = encodeCursor({ c: 1755242400000, i: 'm-2' });
    expect(decodeCursor(encoded)).toEqual({ c: 1755242400000, i: 'm-2' });
  });

  it('垃圾串 → INVALID_CURSOR', () => {
    expect(() => decodeCursor('!!!not-base64url-json')).toThrow(BadRequestError);
    expect(() => decodeCursor(Buffer.from('not json').toString('base64url'))).toThrow(
      new BadRequestError('INVALID_CURSOR')
    );
  });

  it('结构非法（缺 i / 同时含 h 与 c / 类型错）→ INVALID_CURSOR', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    expect(() => decodeCursor(enc({ h: 1 }))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor(enc({ h: 1, c: 2, i: 'm' }))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor(enc({ h: '1', i: 'm' }))).toThrow('INVALID_CURSOR');
  });
});
