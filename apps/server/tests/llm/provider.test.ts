import {
  OpenAICompatProvider,
  RetryableLLMError,
  NonRetryableLLMError,
} from '../../src/llm/openai-compat.provider.js';

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

const baseOpts = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  timeoutMs: 100, // 测试用短超时
};

const messages = [{ role: 'user' as const, content: '你好' }];

describe('OpenAICompatProvider.chat — 成功路径', () => {
  it('解析 choices[0].message.content + model + usage', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '你好！' } }],
      model: 'deepseek-chat-001',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      const result = await provider.chat({ messages });
      expect(result.content).toBe('你好！');
      expect(result.model).toBe('deepseek-chat-001');
      expect(result.usage).toEqual({ prompt: 10, completion: 5, total: 15 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maxTokens/temperature 透传到 body', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: unknown;
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await provider.chat({ messages, maxTokens: 2048, temperature: 0.3 });
      const body = capturedBody as Record<string, unknown>;
      expect(body['max_tokens']).toBe(2048);
      expect(body['temperature']).toBe(0.3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('URL 拼接 baseUrl + /chat/completions', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await provider.chat({ messages });
      expect(capturedUrl!).toBe('https://api.deepseek.com/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Authorization header 携带 Bearer apiKey', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers;
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      capturedHeaders = new Headers(init!.headers);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await provider.chat({ messages });
      expect(capturedHeaders!.get('authorization')).toBe('Bearer sk-test');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('OpenAICompatProvider.chat — 错误分类', () => {
  it('429 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(429, { error: { message: 'rate limit' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('500 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(500, { error: { message: 'server error' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('503 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(503, { error: { message: 'unavailable' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('400 → NonRetryableLLMError（含 statusCode）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(400, { error: { message: 'bad request' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toMatchObject({
        name: 'NonRetryableLLMError',
        statusCode: 400,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('401 → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(401, { error: { message: 'unauthorized' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toMatchObject({
        name: 'NonRetryableLLMError',
        statusCode: 401,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('网络错误 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchNetworkError();
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('超时 → RetryableLLMError（AbortController 60s 默认 / 测试用 100ms）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchHang();
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('响应体缺 choices → NonRetryableLLMError（422 等畸形响应走不可重试）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(422, { error: { message: 'malformed' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('200 但 choices 为空 → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { choices: [], model: 'm', usage: {} });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
