import { jest } from '@jest/globals';
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import {
  DASHSCOPE_POLL_INTERVAL_MS,
  DASHSCOPE_TRANSCRIBE_TIMEOUT_MS,
  DashScopeASRProvider,
} from '../../src/llm/asr/dashscope.provider.js';
import { getASRProvider, setASRProvider } from '../../src/llm/asr/factory.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function interruptedJsonResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      controller.error(new TypeError('terminated'));
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/json' } });
}

function fetchSequence(...responses: Response[]): typeof fetch {
  let index = 0;
  return jest.fn<typeof fetch>(async () => {
    const response = responses[index++];
    if (!response) throw new Error('fetch sequence exhausted');
    return response;
  });
}

function successfulTaskSequence(fileUrl: string, resultResponse: Response): typeof fetch {
  return fetchSequence(
    jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r1' }),
    jsonResponse({
      output: {
        task_id: 't',
        task_status: 'SUCCEEDED',
        results: [
          {
            file_url: fileUrl,
            subtask_status: 'SUCCEEDED',
            transcription_url: 'https://result.example/task.json',
          },
        ],
      },
      request_id: 'r2',
    }),
    resultResponse,
  );
}

const baseOpts = {
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'sk-test',
  model: 'fun-asr',
  pollIntervalMs: 10,
  timeoutMs: 1_000,
};
const request = { fileUrl: 'https://s3.example/audio.wav?signature=secret' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
  setASRProvider(undefined);
});

describe('DashScopeASRProvider.transcribe（spec voice-moment §4.1）', () => {
  it('导出 2 秒轮询与 5 分钟整体超时默认值', () => {
    expect(DASHSCOPE_POLL_INTERVAL_MS).toBe(2_000);
    expect(DASHSCOPE_TRANSCRIBE_TIMEOUT_MS).toBe(300_000);
  });

  it('submit 使用 DashScope async JSON，poll 后下载结果并拼接 transcripts 文本', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({ output: { task_id: 'task/1', task_status: 'PENDING' }, request_id: 'r1' }),
      jsonResponse({ output: { task_id: 'task/1', task_status: 'PENDING' }, request_id: 'r2' }),
      jsonResponse({ output: { task_id: 'task/1', task_status: 'RUNNING' }, request_id: 'r3' }),
      jsonResponse({
        output: {
          task_id: 'task/1',
          task_status: 'SUCCEEDED',
          results: [
            {
              file_url: request.fileUrl,
              subtask_status: 'SUCCEEDED',
              transcription_url: 'https://result.example/task-1.json',
            },
          ],
        },
        request_id: 'r4',
      }),
      jsonResponse({ transcripts: [{ text: '第一段' }, { text: '第二段' }] }),
    ];
    globalThis.fetch = jest.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error('fetch sequence exhausted');
      return response;
    });

    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).resolves.toEqual({
      text: '第一段\n第二段',
    });
    expect(calls[0]!.url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
    );
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
    });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({
      model: 'fun-asr',
      input: { file_urls: [request.fileUrl] },
      parameters: {},
    });
    expect(calls.slice(1, 4).map((call) => [call.url, call.init?.method])).toEqual([
      ['https://dashscope.aliyuncs.com/api/v1/tasks/task%2F1', 'GET'],
      ['https://dashscope.aliyuncs.com/api/v1/tasks/task%2F1', 'GET'],
      ['https://dashscope.aliyuncs.com/api/v1/tasks/task%2F1', 'GET'],
    ]);
    expect(calls[4]).toMatchObject({ url: 'https://result.example/task-1.json' });
  });

  it('整体 SUCCEEDED 但唯一子任务 FAILED 仍按 FILE_DOWNLOAD_FAILED 判 Retryable', async () => {
    globalThis.fetch = fetchSequence(
      jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r1' }),
      jsonResponse({
        output: {
          task_id: 't',
          task_status: 'SUCCEEDED',
          results: [
            {
              file_url: request.fileUrl,
              subtask_status: 'FAILED',
              code: 'FILE_DOWNLOAD_FAILED',
              message: 'source unavailable',
            },
          ],
        },
        request_id: 'r2',
      }),
    );

    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
  });

  it.each([
    ['submit 429', fetchSequence(jsonResponse({}, 429))],
    [
      'poll 503',
      fetchSequence(
        jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r' }),
        jsonResponse({}, 503),
      ),
    ],
    ['result 500', successfulTaskSequence(request.fileUrl, jsonResponse({}, 500))],
    [
      'network',
      jest.fn<typeof fetch>(async () => {
        throw new TypeError('ECONNRESET');
      }),
    ],
  ])('%s → RetryableLLMError', async (_name, mockFetch) => {
    globalThis.fetch = mockFetch;
    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
  });

  it.each([
    ['submit', fetchSequence(interruptedJsonResponse())],
    [
      'poll',
      fetchSequence(
        jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r' }),
        interruptedJsonResponse(),
      ),
    ],
    ['result', successfulTaskSequence(request.fileUrl, interruptedJsonResponse())],
  ])('%s 响应体读取中断 → RetryableLLMError', async (_phase, mockFetch) => {
    globalThis.fetch = mockFetch;
    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
  });

  it.each([
    ['submit 400', fetchSequence(jsonResponse({}, 400))],
    [
      'submit JSON 语法错误',
      fetchSequence(new Response('{"broken":', { headers: { 'content-type': 'application/json' } })),
    ],
    [
      '未知 task_status',
      fetchSequence(
        jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r' }),
        jsonResponse({ output: { task_id: 't', task_status: 'MYSTERY' }, request_id: 'r' }),
      ),
    ],
    [
      'FAILED 非下载错误',
      fetchSequence(
        jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r' }),
        jsonResponse({
          output: {
            task_id: 't',
            task_status: 'FAILED',
            results: [{ subtask_status: 'FAILED', code: 'INVALID_FILE', message: 'bad audio' }],
          },
          request_id: 'r',
        }),
      ),
    ],
    ['结果缺 transcripts', successfulTaskSequence(request.fileUrl, jsonResponse({ nope: 1 }))],
    [
      'transcripts text 非字符串',
      successfulTaskSequence(request.fileUrl, jsonResponse({ transcripts: [{ text: 1 }] })),
    ],
  ])('%s → NonRetryableLLMError', async (_name, mockFetch) => {
    globalThis.fetch = mockFetch;
    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });

  it('5 分钟整体超时 → RetryableLLMError', async () => {
    jest.useFakeTimers();
    globalThis.fetch = fetchSequence(
      jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r' }),
      ...Array.from({ length: 10 }, () =>
        jsonResponse({ output: { task_id: 't', task_status: 'RUNNING' }, request_id: 'r' }),
      ),
    );
    const promise = new DashScopeASRProvider({
      ...baseOpts,
      pollIntervalMs: 2_000,
      timeoutMs: 5_000,
    }).transcribe(request);
    const rejection = expect(promise).rejects.toBeInstanceOf(RetryableLLMError);
    await jest.advanceTimersByTimeAsync(6_000);
    await rejection;
  });

  it('submit 响应体读取卡住仍受同一整体 deadline 约束', async () => {
    jest.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
    });
    globalThis.fetch = jest.fn<typeof fetch>(async () =>
      new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    const promise = new DashScopeASRProvider({ ...baseOpts, timeoutMs: 500 }).transcribe(request);
    const observed = promise.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(600);
    const pending = Symbol('pending');
    const outcome = await Promise.race([observed, Promise.resolve(pending)]);

    expect(outcome).toBeInstanceOf(RetryableLLMError);
  });

  it('transcripts 空数组是合法空转写', async () => {
    globalThis.fetch = successfulTaskSequence(request.fileUrl, jsonResponse({ transcripts: [] }));
    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).resolves.toEqual({ text: '' });
  });

  it('fileUrl 不是 HTTP/HTTPS → NonRetryable 且不发请求', async () => {
    const mockFetch = jest.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
    await expect(
      new DashScopeASRProvider(baseOpts).transcribe({ fileUrl: 'file:///tmp/audio.wav' }),
    ).rejects.toBeInstanceOf(NonRetryableLLMError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('submit 200 但缺 output.task_id → NonRetryable', async () => {
    globalThis.fetch = fetchSequence(jsonResponse({ output: {}, request_id: 'r' }));
    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });

  it('SUCCEEDED 的 transcription_url 非 HTTP/HTTPS → NonRetryable', async () => {
    globalThis.fetch = fetchSequence(
      jsonResponse({ output: { task_id: 't', task_status: 'PENDING' }, request_id: 'r1' }),
      jsonResponse({
        output: {
          task_id: 't',
          task_status: 'SUCCEEDED',
          results: [
            {
              subtask_status: 'SUCCEEDED',
              transcription_url: 'file:///tmp/result.json',
            },
          ],
        },
        request_id: 'r2',
      }),
    );
    await expect(new DashScopeASRProvider(baseOpts).transcribe(request)).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });
});

describe('getASRProvider / setASRProvider（三态，与 llm/factory.ts 同范式）', () => {
  it('注入 mock → 返回该 mock（单例缓存）', () => {
    const mock: ASRProvider = { transcribe: async () => ({ text: 'x' }) };
    setASRProvider(mock);
    expect(getASRProvider()).toBe(mock);
    expect(getASRProvider()).toBe(mock);
  });

  it('注入 null → 返回 null（模拟空 key 停用转写）', () => {
    setASRProvider(null);
    expect(getASRProvider()).toBeNull();
  });

  it('重置（undefined）→ 回落真实 config：测试 env 无 ASR_API_KEY → null', () => {
    setASRProvider(undefined);
    expect(getASRProvider()).toBeNull();
  });

  it('配置有 ASR_API_KEY → 默认创建 DashScopeASRProvider 单例', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../../src/config.js', () => ({
        config: {
          ASR_BASE_URL: 'https://dashscope.aliyuncs.com/api/v1',
          ASR_API_KEY: 'sk-factory-test',
          ASR_MODEL: 'fun-asr',
        },
      }));
      const isolatedFactory = await import('../../src/llm/asr/factory.js');
      const isolatedProvider = await import('../../src/llm/asr/dashscope.provider.js');

      const first = isolatedFactory.getASRProvider();
      expect(first).toBeInstanceOf(isolatedProvider.DashScopeASRProvider);
      expect(isolatedFactory.getASRProvider()).toBe(first);
    });
  });
});
