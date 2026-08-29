import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedHomeService } from './feed-home.service';

const emptyPage = { moments: [], nextCursor: null };

const api = vi.hoisted(() => ({
  getFeed: vi.fn().mockResolvedValue({ moments: [], nextCursor: null }),
  getMonthIndex: vi.fn().mockResolvedValue({ months: [] }),
  listTags: vi.fn().mockResolvedValue({ tags: [] }),
  searchMoments: vi.fn().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  }),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(FeedHomeService);

beforeEach(() => {
  api.getFeed.mockReset().mockResolvedValue(emptyPage);
  api.getMonthIndex.mockReset().mockResolvedValue({ months: [] });
  api.listTags.mockReset().mockResolvedValue({ tags: [] });
  const s = resolve(FeedHomeService);
  s.filter = { order: 'happened_at' };
  s.moments = [];
  s.nextCursor = null;
});

describe('FeedHomeService chip 过滤', () => {
  it('togglePersonFilter 单选；再点同一人清除；getFeed 带 personId 不带 personName', async () => {
    const s = resolve(FeedHomeService);
    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    expect(s.filter.personId).toBe('p-1');
    expect(s.filter.personName).toBe('外婆');
    expect(s.filtered).toBe(true);
    expect(api.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p-1', place: undefined, limit: 50 }),
    );
    const sent = api.getFeed.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('personName');

    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    expect(s.filter.personId).toBeUndefined();
    expect(s.filtered).toBe(false);

    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    await s.togglePersonFilter({ id: 'p-2', name: '爸爸' });
    expect(s.filter.personId).toBe('p-2');
    expect(s.filter.personName).toBe('爸爸');
  });

  it('togglePlaceFilter 等值；clearFilters 清掉人/地', async () => {
    const s = resolve(FeedHomeService);
    await s.togglePlaceFilter('朝阳公园');
    expect(s.filter.place).toBe('朝阳公园');
    await s.togglePlaceFilter('朝阳公园');
    expect(s.filter.place).toBeUndefined();
    await s.togglePlaceFilter('朝阳公园');
    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    s.clearFilters();
    expect(s.filter).toEqual({ order: 'happened_at' });
  });

  it('loadMeta 的 month-index 不带 personId/place', async () => {
    const s = resolve(FeedHomeService);
    s.filter = { order: 'happened_at', personId: 'p-1', place: '朝阳公园' };
    await s.loadMeta();
    expect(api.getMonthIndex).toHaveBeenCalledWith(
      expect.objectContaining({ chainIds: undefined, tagId: undefined }),
    );
    const arg = api.getMonthIndex.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('personId');
    expect(arg).not.toHaveProperty('place');
  });
});
