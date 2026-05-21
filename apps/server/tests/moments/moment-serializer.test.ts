import { momentSerializer } from '../../src/moments/moment-serializer.js';

const moment = {
  id: 'm-1',
  chainId: 'c-1',
  authorId: 'u-1',
  type: 'media' as const,
  content: '九张图',
  happenedAt: new Date('2026-08-15T02:00:00Z'),
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: new Date('2026-08-15T02:00:01Z'),
};

describe('momentSerializer（moment → API 响应唯一出口）', () => {
  it('media 按 sortOrder 升序，url 是稳定入口相对路径（不内嵌预签名）', () => {
    const res = momentSerializer(moment, {
      media: [
        { id: 'md-2', mime: 'image/jpeg', width: 100, height: 200, duration: null, sortOrder: 1 },
        { id: 'md-1', mime: 'image/png', width: 10, height: 20, duration: null, sortOrder: 0 },
      ],
      author: { id: 'u-1', nickname: 'Alice' },
    });
    expect(res.media.map((m) => m.id)).toEqual(['md-1', 'md-2']);
    expect(res.media[0].url).toBe('/api/media/md-1');
    expect(JSON.stringify(res)).not.toContain('https://');
    expect(res.happenedAt).toBe('2026-08-15T02:00:00.000Z');
    expect(res.author).toEqual({ id: 'u-1', nickname: 'Alice' });
    expect(res.tags).toEqual([]);
  });

  it('text 类型 media 为空数组', () => {
    const res = momentSerializer(
      { ...moment, type: 'text', content: 'hi' },
      { media: [], author: { id: 'u-1', nickname: 'Alice' } }
    );
    expect(res.media).toEqual([]);
    expect(res.tags).toEqual([]);
  });

  it('extras.tags 原样挂到响应', () => {
    const res = momentSerializer(moment, {
      media: [],
      author: { id: 'u-1', nickname: 'Alice' },
      tags: [{ id: 't-1', name: '周岁' }],
    });
    expect(res.tags).toEqual([{ id: 't-1', name: '周岁' }]);
    expect(res.author).toEqual({ id: 'u-1', nickname: 'Alice' });
    expect(res.media).toEqual([]);
  });
});
