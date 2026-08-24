import { register, resolve } from '@rabjs/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomentResponse } from '@moment/dto';
import { MemoriesService } from './memories.service';

// 那年今日页面级 Service（spec memories-today §4）：
// - 构造即拉一次（入口条判定，构造路径与 load 同一实现）；date = 查看者本地今天，拉取时定格为字符串；
// - 面板每次打开都重拉（跨午夜不驻留旧日期）；收起不重拉；
// - 空结果 summary = null（入口条不渲染）；失败降级：错误留在 $model.load.error，years 保持空。

const api = vi.hoisted(() => ({
  getMemoriesToday: vi.fn(),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(MemoriesService);

function moment(id: string): MomentResponse {
  return {
    id,
    chainId: 'chain-1',
    author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
    type: 'text',
    kind: 'standard',
    payload: null,
    content: id,
    transcript: null,
    transcriptionStatus: null,
    happenedAt: '2025-08-19T02:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2025-08-19T02:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

/** local noon：任意时区下查看者本地日期都落在当天。 */
function atLocalNoon(y: number, m: number, d: number) {
  vi.setSystemTime(new Date(y, m - 1, d, 12));
}

beforeEach(async () => {
  vi.useFakeTimers();
  atLocalNoon(2026, 8, 19);
  api.getMemoriesToday.mockReset();
  api.getMemoriesToday.mockResolvedValue({ years: [] });
  // 全局容器单例跨用例复用：放掉构造器自启的 load（仅首次 resolve 触发）后逐字段重置
  const service = resolve(MemoriesService);
  await flush();
  api.getMemoriesToday.mockClear();
  service.years = [];
  service.open = false;
  service.today = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MemoriesService', () => {
  it('load 拉取分组，date 为查看者本地今天并定格', async () => {
    api.getMemoriesToday.mockResolvedValue({ years: [{ year: 2025, moments: [moment('a')] }] });
    const service = resolve(MemoriesService);
    await service.load();

    expect(api.getMemoriesToday).toHaveBeenCalledTimes(1);
    expect(api.getMemoriesToday).toHaveBeenCalledWith('2026-08-19');
    expect(service.today).toBe('2026-08-19');
    expect(service.years).toHaveLength(1);
  });

  it('面板每次打开都重拉，today 在打开时定格；收起不重拉', async () => {
    const service = resolve(MemoriesService);

    atLocalNoon(2026, 8, 20); // 跨午夜
    service.toggle();
    await flush();
    expect(service.open).toBe(true);
    expect(api.getMemoriesToday).toHaveBeenCalledTimes(1);
    expect(api.getMemoriesToday).toHaveBeenLastCalledWith('2026-08-20');
    expect(service.today).toBe('2026-08-20');

    service.toggle(); // 收起
    await flush();
    expect(api.getMemoriesToday).toHaveBeenCalledTimes(1);

    service.toggle(); // 再次打开仍重拉
    await flush();
    expect(api.getMemoriesToday).toHaveBeenCalledTimes(2);
  });

  it('空结果 summary 为 null（入口条不渲染）；有结果时汇总最近周年与总条数', () => {
    const service = resolve(MemoriesService);
    expect(service.summary).toBeNull();

    service.years = [
      { year: 2025, moments: [moment('a'), moment('b')] },
      { year: 2020, moments: [moment('c')] },
    ];
    service.today = '2026-08-19';
    expect(service.summary).toEqual({ yearsAgo: 1, count: 3 });
  });

  it('加载失败降级：错误留在 $model.load.error，years 保持空（入口条隐藏）', async () => {
    api.getMemoriesToday.mockRejectedValue(new Error('NETWORK'));
    const service = resolve(MemoriesService);
    await service.load().catch(() => undefined); // 组件侧读 $model.load.error，调用点不再抛

    expect(service.summary).toBeNull();
    expect(service.$model.load.error).toBeInstanceOf(Error);
  });
});
