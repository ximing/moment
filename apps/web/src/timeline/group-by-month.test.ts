import { describe, expect, it } from 'vitest';
import type { PublicShareMoment } from '@moment/dto';
import { groupMomentsByMonth, monthHeading } from './group-by-month';

function m(partial: Partial<PublicShareMoment> & Pick<PublicShareMoment, 'id' | 'happenedAt' | 'createdAt'>): PublicShareMoment {
  return {
    chainId: 'c-1',
    author: { id: 'u-1', nickname: '林', avatarUrl: null },
    type: 'text',
    kind: 'standard',
    payload: null,
    content: '',
    transcript: null,
    transcriptionStatus: null,
    happenedTzOffset: -480,
    isBackfill: false,
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...partial,
  };
}

describe('groupMomentsByMonth', () => {
  it('按 happened_at 墙钟月归并，跨页同一月只一组、组内保持传入顺序', () => {
    const a = m({ id: 'a', happenedAt: '2026-08-31T16:00:00.000Z', createdAt: '2026-08-31T16:00:00.000Z' }); // 东八 9/1 00:00
    const b = m({ id: 'b', happenedAt: '2026-08-01T16:00:00.000Z', createdAt: '2026-08-01T16:00:00.000Z' }); // 东八 8/2
    const c = m({ id: 'c', happenedAt: '2026-08-20T02:00:00.000Z', createdAt: '2026-08-20T02:00:00.000Z' }); // 东八 8/20
    const groups = groupMomentsByMonth([a, b, c]);
    expect(groups.map((g) => g.month)).toEqual(['2026-09', '2026-08']);
    expect(groups[1]!.moments.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('order=created_at 用 createdAt + happenedTzOffset 墙钟月', () => {
    const late = m({
      id: 'late',
      happenedAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-09-01T02:00:00.000Z',
    });
    expect(groupMomentsByMonth([late], 'created_at')[0]!.month).toBe('2026-09');
  });
});

describe('monthHeading', () => {
  it('YYYY-MM → 「2026 · 9 月」', () => {
    expect(monthHeading('2026-09')).toBe('2026 · 9 月');
  });
});
