import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';
import type { ASRProvider } from '../../src/llm/asr/base.provider.js';
import { getASRProvider, setASRProvider } from '../../src/llm/asr/factory.js';
import { OpenAICompatASRProvider } from '../../src/llm/asr/openai-compat.provider.js';

/** mock fetch 工厂：返回指定 status + JSON body（与 tests/llm/provider.test.ts 同范式） */
function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function mockFetchNetworkError(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed: ECONNREFUSED');
  }) as typeof fetch;
}

/** mock fetch 永不 resolve，signal abort 时 reject AbortError（触发 provider 超时路径） */
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
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKey: 'sk-test',
  model: 'FunAudioLLM/SenseVoiceSmall',
  timeoutMs: 100,
};
const audioReq = { audio: Buffer.from('fake-wav'), mime: 'audio/wav' };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('OpenAICompatASRProvider.transcribe（spec voice-moment §4.1）', () => {
  it('成功：multipart POST {baseUrl}/audio/transcriptions，file + model 字段，解析 text', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    let seenAuth = '';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seenUrl = String(input);
      seenBody = init?.body;
      seenAuth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '');
      return new Response(JSON.stringify({ text: '宝宝第一次叫奶奶' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const res = await new OpenAICompatASRProvider(baseOpts).transcribe(audioReq);

    expect(res.text).toBe('宝宝第一次叫奶奶');
    expect(seenUrl).toBe('https://api.siliconflow.cn/v1/audio/transcriptions');
    expect(seenAuth).toBe('Bearer sk-test');
    expect(seenBody).toBeInstanceOf(FormData);
    const form = seenBody as FormData;
    expect(form.get('model')).toBe('FunAudioLLM/SenseVoiceSmall');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('audio.wav'); // mime → filename 扩展名
  });

  it('空文本是合法转写结果（笑声/环境音），返回空串', async () => {
    globalThis.fetch = mockFetch(200, { text: '' });
    const res = await new OpenAICompatASRProvider(baseOpts).transcribe(audioReq);
    expect(res.text).toBe('');
  });

  it('429 / 5xx → RetryableLLMError', async () => {
    globalThis.fetch = mockFetch(429, { error: { message: 'rate limited' } });
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    globalThis.fetch = mockFetch(500, {});
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
  });

  it('其他 4xx → NonRetryableLLMError', async () => {
    globalThis.fetch = mockFetch(400, { error: { message: 'bad file' } });
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });

  it('网络错误 → RetryableLLMError', async () => {
    globalThis.fetch = mockFetchNetworkError();
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
  });

  it('超时（AbortError）→ RetryableLLMError', async () => {
    globalThis.fetch = mockFetchHang();
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
  });

  it('200 但缺 text → NonRetryableLLMError（畸形响应不重试）', async () => {
    globalThis.fetch = mockFetch(200, { nope: 1 });
    await expect(new OpenAICompatASRProvider(baseOpts).transcribe(audioReq)).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });
});

describe('getASRProvider / setASRProvider（三态，与 llm/factory.ts 同范式）', () => {
  afterEach(() => setASRProvider(undefined));

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
});
