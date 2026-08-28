import { AmapProvider } from '../../src/geocode/amap.provider.js';
import { wgs84ToGcj02 } from '../../src/geocode/gcj02.js';
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';

/** mock fetch 工厂：返回指定 status + body 的 Response */
function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

/** mock fetch 抛网络错误 */
function mockFetchNetworkError(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed: ECONNREFUSED');
  }) as typeof fetch;
}

/** mock fetch 永不 resolve（模拟超时）。
 * 真实 fetch 会在 signal abort 时 reject 一个 name='AbortError' 的错误；mock 须模拟此行为，
 * 否则 provider 的 AbortController 超时无法触发 fetch reject（测试会挂到 jest 超时）。 */
function mockFetchHang(): typeof fetch {
  return ((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        },
        { once: true },
      );
    })) as typeof fetch;
}

const baseOpts = { apiKey: 'amap-test-key' };

describe('AmapProvider.reverse — 成功路径', () => {
  it('解析 regeocode.formatted_address；URL 携带 key 与 GCJ-02 location（lng 在前、6 位小数，spec §4）', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({
          status: '1',
          info: 'OK',
          infocode: '10000',
          regeocode: { formatted_address: '北京市东城区东华门街道天安门广场' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new AmapProvider(baseOpts);
      const address = await provider.reverse(39.9042, 116.4074);
      expect(address).toBe('北京市东城区东华门街道天安门广场');

      const u = new URL(capturedUrl!);
      expect(u.origin + u.pathname).toBe('https://restapi.amap.com/v3/geocode/regeo');
      expect(u.searchParams.get('key')).toBe('amap-test-key');
      // location：先 WGS-84→GCJ-02，再 lng,lat 顺序拼接（spec §4，计划偏差 9）
      const gcj = wgs84ToGcj02(39.9042, 116.4074);
      expect(u.searchParams.get('location')).toBe(`${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('境外坐标不换算：location 用原值（东京，spec §4「境外不偏移直接请求」）', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({ status: '1', regeocode: { formatted_address: '東京都千代田区' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new AmapProvider(baseOpts);
      const address = await provider.reverse(35.6895, 139.6917);
      expect(address).toBe('東京都千代田区');
      expect(new URL(capturedUrl!).searchParams.get('location')).toBe('139.691700,35.689500');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('status=1 但 formatted_address 缺失/为空 → 返回 null（确定无地址，不重试）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { status: '1', regeocode: {} });
    try {
      const provider = new AmapProvider(baseOpts);
      expect(await provider.reverse(39.9042, 116.4074)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = mockFetch(200, { status: '1', regeocode: { formatted_address: '' } });
    try {
      const provider = new AmapProvider(baseOpts);
      expect(await provider.reverse(39.9042, 116.4074)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('AmapProvider.reverse — 错误分类（计划偏差 3）', () => {
  it('amap status !== "1"（如 INVALID_USER_KEY）→ NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { status: '0', info: 'INVALID_USER_KEY', infocode: '10001' });
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toMatchObject({
        name: 'NonRetryableLLMError',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 500 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(500, {});
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 429 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(429, {});
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 403 → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(403, {});
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('网络错误 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchNetworkError();
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('超时 → RetryableLLMError（默认 10s，测试用 100ms，计划偏差 8）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchHang();
    try {
      const provider = new AmapProvider({ apiKey: 'amap-test-key', timeoutMs: 100 });
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('2xx 但响应体非 JSON → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('<html>gateway error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
