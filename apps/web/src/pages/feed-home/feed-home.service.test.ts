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
  api.searchMoments.mockReset().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  });
  const s = resolve(FeedHomeService);
  s.filter = { order: 'happened_at' };
  s.moments = [];
  s.nextCursor = null;
  s.searching = false;
  s.searchQ = '';
  s.searchParsed = null;
  s.searchError = null;
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

describe('FeedHomeService 搜索（spec §7.2）', () => {
  it('submitSearch POST searchMoments：带 personId/tagId/place，不带 before', async () => {
    const s = resolve(FeedHomeService);
    s.filter = {
      order: 'happened_at',
      personId: 'p-1',
      personName: '外婆',
      tagId: 't-1',
      place: '朝阳公园',
      before: '2026-09-01T00:00:00.000Z',
      chainIds: ['c-1'],
    };
    api.searchMoments.mockResolvedValueOnce({
      moments: [{ id: 'm-hit' }],
      nextCursor: 'next',
      parsed: { personNames: ['外婆'], place: null, time: null, text: '' },
    });
    await s.submitSearch('去年今天和外婆');
    expect(s.searching).toBe(true);
    expect(s.moments).toEqual([{ id: 'm-hit' }]);
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    expect(api.searchMoments).toHaveBeenCalledTimes(1);
    const body = api.searchMoments.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.q).toBe('去年今天和外婆');
    expect(body.personId).toBe('p-1');
    expect(body.tagId).toBe('t-1');
    expect(body.place).toBe('朝阳公园');
    expect(body.chainIds).toEqual(['c-1']);
    expect(body.limit).toBe(50);
    expect(typeof body.tzOffset).toBe('number');
    expect(body).not.toHaveProperty('before');
    expect(body).not.toHaveProperty('order');
    expect(body).not.toHaveProperty('source');
  });

  it('loadMore 在 searching 时继续 POST + cursor，不带 before，不改 searchParsed', async () => {
    const s = resolve(FeedHomeService);
    api.searchMoments
      .mockResolvedValueOnce({
        moments: [{ id: 'm-1' }],
        nextCursor: 's-cur',
        parsed: { personNames: ['外婆'], place: null, time: null, text: '' },
      })
      .mockResolvedValueOnce({
        moments: [{ id: 'm-2' }],
        nextCursor: null,
        parsed: { personNames: [], place: null, time: null, text: '漂移' },
      });
    await s.submitSearch('外婆');
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    await s.loadMore();
    expect(s.moments.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    expect(api.searchMoments).toHaveBeenCalledTimes(2);
    const more = api.searchMoments.mock.calls[1]![0] as Record<string, unknown>;
    expect(more.q).toBe('外婆');
    expect(more.cursor).toBe('s-cur');
    expect(more).not.toHaveProperty('before');
    expect(more).not.toHaveProperty('parsed');
  });

  it('exitSearch 清搜索游标并改回 getFeed', async () => {
    const s = resolve(FeedHomeService);
    api.searchMoments.mockResolvedValueOnce({
      moments: [{ id: 'm-hit' }],
      nextCursor: 's-cur',
      parsed: { personNames: [], place: null, time: null, text: 'q' },
    });
    await s.submitSearch('外婆');
    api.getFeed.mockClear();
    await s.exitSearch();
    expect(s.searching).toBe(false);
    expect(s.searchParsed).toBeNull();
    expect(api.getFeed).toHaveBeenCalled();
    expect(api.searchMoments).toHaveBeenCalledTimes(1);
  });

  it('搜索 429 写入 searchError，不覆盖 moments，不调用 toast', async () => {
    const { ApiError } = await import('@moment/api-client');
    const s = resolve(FeedHomeService);
    s.moments = [{ id: 'keep' } as never];
    api.searchMoments.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 429, 'RATE_LIMITED'));
    await s.submitSearch('外婆');
    expect(s.moments).toEqual([{ id: 'keep' }]);
    expect(s.searchError).toBeInstanceOf(ApiError);
    expect((s.searchError as { code: string }).code).toBe('RATE_LIMITED');
  });
});

