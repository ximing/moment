import { act, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaObjectUrl } from './useMediaObjectUrl';

// useMediaObjectUrl 模块级去重（chain-appearance §7.5 / plan Task 9）：
// - 同一 mediaId 的所有消费者共享一次 fetchMediaBlob 与一个 object URL（汇总时间线
//   50 条同链时刻不重复下载同一头像）；
// - 最后一个消费者卸载才 revoke URL 并移除缓存 entry；
// - fetch 失败通知 null 并移除 entry，后续渲染可以重试。

const api = vi.hoisted(() => ({
  fetchMediaBlob: vi.fn(),
}));

vi.mock('@/api/client', () => ({ client: api }));

const urlLog = vi.hoisted(() => ({
  created: [] as string[],
  revoked: [] as string[],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 测试消费者：渲染当前 hook 产出的 URL。 */
function Consumer({ mediaId }: { mediaId: string | null }) {
  return <output data-testid="media-url">{useMediaObjectUrl(mediaId) ?? ''}</output>;
}

const renderedUrls = () => screen.getAllByTestId('media-url').map((el) => el.textContent);

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      const url = `blob:obj-${urlLog.created.length + 1}`;
      urlLog.created.push(url);
      return url;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((url: string) => {
      urlLog.revoked.push(url);
    }),
  });
});

beforeEach(() => {
  api.fetchMediaBlob.mockReset();
  urlLog.created.length = 0;
  urlLog.revoked.length = 0;
});

describe('useMediaObjectUrl 共享与回收', () => {
  it('同一 mediaId 挂 20 个消费者只发一次 fetch，共享同一 object URL', async () => {
    const d = deferred<Blob>();
    api.fetchMediaBlob.mockReturnValue(d.promise);
    const views = Array.from({ length: 20 }, () => render(<Consumer mediaId="m-1" />));

    expect(api.fetchMediaBlob).toHaveBeenCalledTimes(1);
    expect(api.fetchMediaBlob).toHaveBeenCalledWith('m-1');
    // URL 未就绪：全部为空
    expect(renderedUrls()).toEqual(Array.from({ length: 20 }, () => ''));

    await act(async () => d.resolve(new Blob(['x'])));

    expect(urlLog.created).toHaveLength(1);
    expect(renderedUrls()).toEqual(Array.from({ length: 20 }, () => 'blob:obj-1'));

    for (const view of views) view.unmount();
  });

  it('中间消费者卸载不 revoke，最后一个卸载才 revoke 并移除 entry', async () => {
    const d = deferred<Blob>();
    api.fetchMediaBlob.mockReturnValue(d.promise);
    const first = render(<Consumer mediaId="m-1" />);
    const second = render(<Consumer mediaId="m-1" />);
    const third = render(<Consumer mediaId="m-1" />);
    await act(async () => d.resolve(new Blob(['x'])));

    first.unmount();
    expect(urlLog.revoked).toEqual([]);
    second.unmount();
    expect(urlLog.revoked).toEqual([]);

    third.unmount();
    expect(urlLog.revoked).toEqual(['blob:obj-1']);

    // entry 已移除：重新挂载走新一次 fetch
    const d2 = deferred<Blob>();
    api.fetchMediaBlob.mockReturnValue(d2.promise);
    const again = render(<Consumer mediaId="m-1" />);
    expect(api.fetchMediaBlob).toHaveBeenCalledTimes(2);
    await act(async () => d2.resolve(new Blob(['y'])));
    expect(renderedUrls()).toEqual(['blob:obj-2']);
    again.unmount();
    expect(urlLog.revoked).toEqual(['blob:obj-1', 'blob:obj-2']);
  });

  it('fetch 失败通知 null 并移除 entry，后续渲染可以重试', async () => {
    const d = deferred<Blob>();
    api.fetchMediaBlob.mockReturnValue(d.promise);
    const first = render(<Consumer mediaId="m-1" />);

    await act(async () => d.reject(new Error('boom')));
    expect(renderedUrls()).toEqual(['']);

    // 同一消费者仍挂着：entry 已删除，重挂载（或新消费者）触发重试
    const d2 = deferred<Blob>();
    api.fetchMediaBlob.mockReturnValue(d2.promise);
    const second = render(<Consumer mediaId="m-1" />);
    expect(api.fetchMediaBlob).toHaveBeenCalledTimes(2);
    await act(async () => d2.resolve(new Blob(['x'])));
    // 老消费者收过 null 不重订阅；新消费者拿到重试成果
    expect(renderedUrls()).toEqual(['', 'blob:obj-1']);
    first.unmount();
    second.unmount();
  });

  it('不同 mediaId 各自 fetch 与回收，互不共享', async () => {
    const d1 = deferred<Blob>();
    const d2 = deferred<Blob>();
    api.fetchMediaBlob.mockImplementation((id: string) => (id === 'm-1' ? d1.promise : d2.promise));
    const one = render(<Consumer mediaId="m-1" />);
    const two = render(<Consumer mediaId="m-2" />);
    expect(api.fetchMediaBlob).toHaveBeenCalledTimes(2);

    await act(async () => d1.resolve(new Blob(['a'])));
    await act(async () => d2.resolve(new Blob(['b'])));
    expect(renderedUrls().sort()).toEqual(['blob:obj-1', 'blob:obj-2']);

    two.unmount();
    expect(urlLog.revoked).toEqual(['blob:obj-2']);
    one.unmount();
    expect(urlLog.revoked).toEqual(['blob:obj-2', 'blob:obj-1']);
  });

  it('所有消费者在 fetch 落地前全部卸载：结果落地即 revoke，不泄漏 object URL', async () => {
    const d = deferred<Blob>();
    api.fetchMediaBlob.mockReturnValue(d.promise);
    const view = render(<Consumer mediaId="m-1" />);
    expect(api.fetchMediaBlob).toHaveBeenCalledTimes(1);
    view.unmount();

    await act(async () => d.resolve(new Blob(['x'])));
    // 创建出来的 URL 没有消费者承接，落地即撤销
    expect(urlLog.created).toEqual(['blob:obj-1']);
    expect(urlLog.revoked).toEqual(['blob:obj-1']);
  });

  it('mediaId 为 null 不发请求、URL 为 null', () => {
    const view = render(<Consumer mediaId={null} />);
    expect(api.fetchMediaBlob).not.toHaveBeenCalled();
    expect(renderedUrls()).toEqual(['']);
    view.unmount();
  });
});
