import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberViewedMoment, resetTimelineListSession } from '@/lib/timeline-list-session';
import { ChainHomeService } from './chain-home.service';

const api = vi.hoisted(() => ({
  getFeed: vi.fn().mockResolvedValue({ moments: [], nextCursor: null }),
  getMonthIndex: vi.fn().mockResolvedValue({ months: [] }),
  listTags: vi.fn().mockResolvedValue({ tags: [] }),
  getChain: vi.fn().mockResolvedValue({ id: 'c-1', myRole: 'owner', templateManifest: { version: 1 } }),
  getMoment: vi.fn(),
  updateChain: vi.fn(),
  uploadMedia: vi.fn(),
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
  api.getMoment.mockReset();
  api.updateChain.mockReset().mockResolvedValue({});
  api.uploadMedia.mockReset();
  api.searchMoments.mockReset().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  });
  resetTimelineListSession();
  const s = resolve(ChainHomeService);
  s.chainId = 'c-1';
  s.chain = { id: 'c-1', myRole: 'owner' } as never;
  s.filter = { order: 'happened_at', chainIds: ['c-1'] };
  s.moments = [];
  s.nextCursor = null;
  s.monthIndex = [];
  s.tags = [];
  s.searching = false;
  s.searchQ = '';
  s.searchParsed = null;
  s.searchError = null;
  s.coverBusy = false;
  s.coverError = null;
  s.repositioning = false;
  s.repositionFocus = null;
  s.restoredScrollY = 0;
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

  it('clearBefore 清 before 并滚回页顶', () => {
    document.documentElement.scrollTop = 120;
    const s = resolve(ChainHomeService);
    s.filter = { order: 'happened_at', chainIds: ['c-1'], before: '2026-09-01T00:00:00.000Z' };
    s.clearBefore();
    expect(s.filter.before).toBeUndefined();
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it('filtered 在仅 personId 时为 true；clearFilters 保留本链 chainIds', () => {
    const s = resolve(ChainHomeService);
    s.filter = { order: 'happened_at', chainIds: ['c-1'], personId: 'p-1', personName: '外婆' };
    expect(s.filtered).toBe(true);
    s.clearFilters();
    expect(s.filter).toEqual({ order: 'happened_at', chainIds: ['c-1'] });
  });

  it('链页搜索 chainIds 恒为 [chainId]，忽略轨上其它链', async () => {
    const s = resolve(ChainHomeService);
    api.searchMoments.mockResolvedValueOnce({
      moments: [],
      nextCursor: null,
      parsed: { personNames: [], place: null, time: null, text: '外婆' },
    });
    await s.submitSearch('外婆');
    expect(api.searchMoments.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ q: '外婆', chainIds: ['c-1'] }),
    );
    const body = api.searchMoments.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('before');
  });
});

describe('ChainHomeService 封面', () => {
  it('replaceCover 上传后 PATCH coverMediaId + 居中焦点，并重拉链', async () => {
    const s = resolve(ChainHomeService);
    api.uploadMedia.mockResolvedValue({ mediaId: 'm-new', status: 'ready', mime: 'image/png', size: 1 });
    api.getChain.mockResolvedValue({
      id: 'c-1',
      coverMediaId: 'm-new',
      coverUrl: '/api/media/m-new',
      coverFocus: { x: 0.5, y: 0.5 },
    });
    const file = new File(['x'], 'c.png', { type: 'image/png' });

    await s.replaceCover(file);

    expect(api.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', mime: 'image/png' }));
    expect(api.updateChain).toHaveBeenCalledWith('c-1', {
      coverMediaId: 'm-new',
      coverFocus: { x: 0.5, y: 0.5 },
    });
    expect(s.chain).toMatchObject({ coverMediaId: 'm-new' });
    expect(s.coverBusy).toBe(false);
    expect(s.coverError).toBeNull();
    expect(s.repositioning).toBe(false);
  });

  it('removeCover 提交 coverMediaId:null', async () => {
    const s = resolve(ChainHomeService);
    api.getChain.mockResolvedValue({ id: 'c-1', coverMediaId: null, coverUrl: null, coverFocus: null });

    await s.removeCover();

    expect(api.updateChain).toHaveBeenCalledWith('c-1', { coverMediaId: null });
    expect(s.chain).toMatchObject({ coverMediaId: null });
    expect(s.coverBusy).toBe(false);
  });

  it('saveReposition 提交传入的 coverFocus', async () => {
    const s = resolve(ChainHomeService);
    s.chain = { id: 'c-1', coverUrl: '/api/media/c', coverFocus: { x: 0.2, y: 0.3 } } as never;
    s.startReposition();
    s.setRepositionFocus({ x: 0.1, y: 0.9 });
    api.getChain.mockResolvedValue({
      id: 'c-1',
      coverUrl: '/api/media/c',
      coverFocus: { x: 0.1, y: 0.9 },
    });

    await s.saveReposition({ x: 0.4, y: 0.6 });

    expect(api.updateChain).toHaveBeenCalledWith('c-1', { coverFocus: { x: 0.4, y: 0.6 } });
    expect(s.repositioning).toBe(false);
    expect(s.repositionFocus).toBeNull();
  });

  it('replaceCover 失败写入 coverError，不抛出', async () => {
    const s = resolve(ChainHomeService);
    api.uploadMedia.mockRejectedValue(new Error('直传失败（500）'));
    const file = new File(['x'], 'c.png', { type: 'image/png' });

    await s.replaceCover(file);

    expect(s.coverError).toBe('出了点问题，请重试');
    expect(s.coverBusy).toBe(false);
    expect(api.updateChain).not.toHaveBeenCalled();
  });
});

describe('ChainHomeService 点赞/评论不整表重拉', () => {
  it('comment:changed 只 getMoment 替换该条，不 getFeed', async () => {
    const s = resolve(ChainHomeService);
    const kept = { id: 'm-keep', commentCount: 0 } as never;
    s.moments = [kept, { id: 'm-1', commentCount: 0 } as never];
    api.getMoment.mockResolvedValueOnce({ id: 'm-1', commentCount: 2 });
    api.getFeed.mockClear();
    s.emit('comment:changed', { momentId: 'm-1' }, 'global');
    await vi.waitFor(() => expect(s.moments[1]).toEqual({ id: 'm-1', commentCount: 2 }));
    expect(s.moments[0]).toEqual(kept);
    expect(api.getMoment).toHaveBeenCalledWith('m-1');
    expect(api.getFeed).not.toHaveBeenCalled();
  });
});

describe('ChainHomeService 从详情返回只补一条', () => {
  it('adoptSession 恢复本链列表后 hydrate 同 id 不再 loadFirst', async () => {
    const s = resolve(ChainHomeService);
    const kept = { id: 'm-keep' } as never;
    s.moments = [kept, { id: 'm-1', commentCount: 0 } as never];
    s.nextCursor = 'c-next';
    s.persistSession(180);
    s.moments = [];
    s.chainId = '';
    s.chain = null;
    rememberViewedMoment('m-1');
    api.getMoment.mockResolvedValueOnce({ id: 'm-1', commentCount: 2 });
    api.getFeed.mockClear();
    api.getChain.mockClear();

    expect(s.adoptSession()).toBe(true);
    expect(s.chainId).toBe('c-1');
    expect(s.moments[0]).toEqual(kept);
    expect(s.restoredScrollY).toBe(180);
    s.hydrate('c-1');
    expect(api.getFeed).not.toHaveBeenCalled();
    expect(api.getChain).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(s.moments[1]).toEqual({ id: 'm-1', commentCount: 2 }));
  });
});

