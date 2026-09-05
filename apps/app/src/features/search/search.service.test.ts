import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, resolve } from '@rabjs/react';
import { SearchService } from './search.service';
import { ChainListService } from '../../services/chain-list.service';
import { AuthService } from '../../services/auth.service';

const api = vi.hoisted(() => ({
  searchMoments: vi.fn(),
  getMoment: vi.fn(),
  listChains: vi.fn(),
  me: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  client: api,
  apiUrl: 'http://x',
  webUrl: 'http://x',
}));
vi.mock('../../lib/token-store', () => ({
  loadUser: vi.fn(async () => null),
  onAuthCleared: vi.fn(),
  saveUser: vi.fn(),
  secureTokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
}));

register(AuthService);
register(ChainListService);
register(SearchService);

function svc(): SearchService {
  return resolve(SearchService);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.searchMoments.mockResolvedValue({
    moments: [{ id: 'm-hit' }],
    nextCursor: 'next',
    parsed: { personNames: ['外婆'], place: null, time: null, text: '' },
  });
  const s = svc();
  s.reset();
});

describe('SearchService', () => {
  it('时刻流 hydrate 不带 chainId，submit 搜全部链', async () => {
    const s = svc();
    s.hydrate(undefined);
    await s.submit('去年今天和外婆');
    expect(s.hasSubmitted).toBe(true);
    expect(s.moments).toEqual([{ id: 'm-hit' }]);
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    const body = api.searchMoments.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.q).toBe('去年今天和外婆');
    expect(body.limit).toBe(20);
    expect(body).not.toHaveProperty('chainIds');
    expect(body).not.toHaveProperty('before');
    expect(body).not.toHaveProperty('order');
  });

  it('单链 hydrate 后 submit 只带该 chainIds', async () => {
    const s = svc();
    s.hydrate('c-1');
    await s.submit('外婆');
    const body = api.searchMoments.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.chainIds).toEqual(['c-1']);
    expect(body.q).toBe('外婆');
  });

  it('空查询不发请求', async () => {
    const s = svc();
    s.hydrate(undefined);
    await s.submit('   ');
    expect(api.searchMoments).not.toHaveBeenCalled();
    expect(s.hasSubmitted).toBe(false);
  });

  it('loadMore 带 cursor 且不覆盖首页 parsed', async () => {
    const s = svc();
    s.hydrate(undefined);
    await s.submit('外婆');
    api.searchMoments.mockResolvedValueOnce({
      moments: [{ id: 'm-2' }],
      nextCursor: null,
      parsed: { personNames: [], place: null, time: null, text: '漂移' },
    });
    await s.loadMore();
    expect(s.moments.map((m) => m.id)).toEqual(['m-hit', 'm-2']);
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    const body = api.searchMoments.mock.calls[1]![0] as Record<string, unknown>;
    expect(body.cursor).toBe('next');
  });
});
