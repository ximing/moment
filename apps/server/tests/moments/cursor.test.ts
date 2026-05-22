import { BadRequestError } from 'routing-controllers';
import { decodeCursor, encodeCursor } from '../../src/feed/cursor.js';

describe('moment cursor（CONVENTIONS §3.4）', () => {
  it('happened_at 游标 roundtrip：{h: epochMs, i: momentId}', () => {
    const encoded = encodeCursor('happened_at', 1755242400000, 'm-1');
    expect(decodeCursor('happened_at', encoded)).toEqual({ time: 1755242400000, id: 'm-1' });
  });

  it('created_at 游标 roundtrip：{c: epochMs, i: momentId}', () => {
    const encoded = encodeCursor('created_at', 1755242400000, 'm-2');
    expect(decodeCursor('created_at', encoded)).toEqual({ time: 1755242400000, id: 'm-2' });
  });

  it('垃圾串 → INVALID_CURSOR', () => {
    expect(() => decodeCursor('happened_at', '!!!not-base64url-json')).toThrow(BadRequestError);
    expect(() => decodeCursor('happened_at', Buffer.from('not json').toString('base64url'))).toThrow(
      new BadRequestError('INVALID_CURSOR')
    );
  });

  it('结构非法（缺 i / 字段类型错 / 错 order 键）→ INVALID_CURSOR', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    expect(() => decodeCursor('happened_at', enc({ h: 1 }))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor('happened_at', enc({ c: 1, i: 'm' }))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor('happened_at', enc({ h: '1', i: 'm' }))).toThrow('INVALID_CURSOR');
  });
});
