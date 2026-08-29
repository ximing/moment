import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainHomeService } from './chain-home.service';

const api = vi.hoisted(() => ({
  getFeed: vi.fn().mockResolvedValue({ moments: [], nextCursor: null }),
  getMonthIndex: vi.fn().mockResolvedValue({ months: [] }),
  listTags: vi.fn().mockResolvedValue({ tags: [] }),
  getChain: vi.fn().mockResolvedValue({ id: 'c-1', myRole: 'owner', templateManifest: { version: 1 } }),
  searchMoments: vi.fn().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  }),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(ChainHomeService);

beforeEach(() => {
  api.getFeed.mockReset().mockResolvedValue({ moments: [], nextCursor: null });
  api.getMonthIndex.mockReset().mockResolvedValue({ months: [] });
  api.listTags.mockReset().mockResolvedValue({ tags: [] });
  api.getChain.mockReset().mockResolvedValue({ id: 'c-1', myRole: 'owner', templateManifest: { version: 1 } });
  const s = resolve(ChainHomeService);
  s.chainId = 'c-1';
  s.filter = { order: 'happened_at', chainIds: ['c-1'] };
  s.moments = [];
  s.nextCursor = null;
});

describe('ChainHomeService chip 过滤', () => {
  it('setFilter 恒带 chainIds:[chainId]；togglePersonFilter 后 getFeed 含 personId', async () => {
    const s = resolve(ChainHomeService);
    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    expect(s.filter.chainIds).toEqual(['c-1']);
    expect(api.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ chainIds: ['c-1'], personId: 'p-1', limit: 50 }),
    );
  });

  it('filtered 在仅 personId 时为 true；clearFilters 保留本链 chainIds', () => {
    const s = resolve(ChainHomeService);
    s.filter = { order: 'happened_at', chainIds: ['c-1'], personId: 'p-1', personName: '外婆' };
    expect(s.filtered).toBe(true);
    s.clearFilters();
    expect(s.filter).toEqual({ order: 'happened_at', chainIds: ['c-1'] });
  });
});
