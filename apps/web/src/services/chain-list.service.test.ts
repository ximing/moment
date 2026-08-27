import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto } from '@moment/dto';
import { AuthService } from './auth.service';
import { ChainListService } from './chain-list.service';

// ChainListService.reorder（spec chain-ordering §6.3/§7）：
// 乐观更新 → PUT → 统一 load 收敛（成功）/回滚（失败，reject 由调用方 toast）；
// 在途期间并发 load() 写回抑制（引用计数，含重入用例——本设计最易出 bug 的点）。

const api = vi.hoisted(() => ({
  listChains: vi.fn(),
  reorderChains: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  client: api,
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);
register(ChainListService);

function chain(id: string): ChainDto {
  return {
    id,
    name: `链${id}`,
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: null,
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ids = (list: ChainDto[]) => list.map((c) => c.id);

beforeEach(() => {
  api.listChains.mockReset();
  api.reorderChains.mockReset();
  // user = null：ChainListService 构造器不自动 load，chains 由用例直接播种
  resolve(AuthService).user = null;
  resolve(ChainListService).chains = [chain('a'), chain('b'), chain('c')];
});

describe('ChainListService.reorder', () => {
  it('乐观更新先行；成功后统一 load 与服务端收敛', async () => {
    const service = resolve(ChainListService);
    const server = deferred();
    api.reorderChains.mockReturnValue(server.promise);
    api.listChains.mockResolvedValue([chain('c'), chain('a'), chain('b')]);

    const p = service.reorder(['c', 'a', 'b']);
    // 乐观：PUT 未返回，chains 已按新顺序（reorder 同步执行到首个 await 之前完成赋值）
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
    expect(api.reorderChains).toHaveBeenCalledWith({ chainIds: ['c', 'a', 'b'] });

    server.resolve();
    await p;
    expect(api.listChains).toHaveBeenCalledTimes(1); // 收尾收敛请求
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
  });

  it('失败：load 回滚到服务端顺序后 reject（reject 是调用方 toast 的触发源）', async () => {
    const service = resolve(ChainListService);
    api.reorderChains.mockRejectedValue(new Error('boom'));
    api.listChains.mockResolvedValue([chain('a'), chain('b'), chain('c')]);

    const p = service.reorder(['c', 'b', 'a']);
    expect(ids(service.chains)).toEqual(['c', 'b', 'a']); // 乐观

    await expect(p).rejects.toThrow('boom');
    expect(ids(service.chains)).toEqual(['a', 'b', 'c']); // 回滚完成才 reject
  });

  it('竞态防护：reorder 在途期间并发 load() 完成的写回被抑制', async () => {
    const service = resolve(ChainListService);
    const server = deferred();
    api.reorderChains.mockReturnValue(server.promise);
    // 并发 load（chain:changed 触发）拉到的是提交前的旧顺序
    api.listChains.mockResolvedValue([chain('x'), chain('a')]);

    const p = service.reorder(['b', 'a', 'c']);
    expect(ids(service.chains)).toEqual(['b', 'a', 'c']);

    await service.load(); // 在途期间的并发 load：请求照发，写回抑制
    expect(ids(service.chains)).toEqual(['b', 'a', 'c']);

    api.listChains.mockResolvedValue([chain('b'), chain('a'), chain('c')]);
    server.resolve();
    await p;
    expect(ids(service.chains)).toEqual(['b', 'a', 'c']);
  });

  it('重入：两次 reorder 并发，第一次先完成时第二次的乐观顺序不被 load 覆盖', async () => {
    const service = resolve(ChainListService);
    const first = deferred();
    const second = deferred();
    api.reorderChains.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    api.listChains.mockResolvedValue([chain('a'), chain('b'), chain('c')]); // 陈旧顺序

    const p1 = service.reorder(['b', 'a', 'c']);
    const p2 = service.reorder(['c', 'a', 'b']);
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);

    // 第一次先完成：其收尾 load 的写回必须仍被第二次的在途计数抑制
    first.resolve();
    await p1;
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);

    // 第二次完成：计数归零，统一 load 收敛（服务端 last-write-wins，最终顺序 = 第二次）
    api.listChains.mockResolvedValue([chain('c'), chain('a'), chain('b')]);
    second.resolve();
    await p2;
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
  });

  it('代际防护：reorder 之前发出的 load 晚于收尾 load 完成时，陈旧写回被丢弃', async () => {
    const service = resolve(ChainListService);
    const staleList = deferred<ChainDto[]>();
    const finalList = deferred<ChainDto[]>();
    api.listChains.mockReturnValueOnce(staleList.promise); // load A（reorder 之前由 chain:changed 触发）
    api.listChains.mockReturnValueOnce(finalList.promise); // 收尾收敛 load B
    api.reorderChains.mockResolvedValue(undefined);

    const a = service.load(); // reorder 之前发出，捕获旧代序号
    const p = service.reorder(['c', 'a', 'b']);
    // 收尾 load B 先完成：收敛到服务端顺序
    finalList.resolve([chain('c'), chain('a'), chain('b')]);
    await p;
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);

    // 陈旧的 load A 更晚完成（此时在途计数已归零）：代序号不等，写回必须被丢弃，不得压过 B
    staleList.resolve([chain('a'), chain('b'), chain('c')]);
    await a;
    expect(ids(service.chains)).toEqual(['c', 'a', 'b']);
  });

  it('无 reorder 在途时 load 正常写回', async () => {
    const service = resolve(ChainListService);
    api.listChains.mockResolvedValue([chain('b')]);
    await service.load();
    expect(ids(service.chains)).toEqual(['b']);
  });
});
