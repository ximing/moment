import { jest } from '@jest/globals';
import nock from 'nock';
import { setLLMProvider } from '../../src/llm/factory.js';
import { OpenAICompatProvider } from '../../src/llm/openai-compat.provider.js';
import { RetryableLLMError, NonRetryableLLMError, type LLMProvider } from '../../src/llm/base.provider.js';
import { INTENT_CHAT_MAX_TOKENS, INTENT_CHAT_TEMPERATURE, INTENT_TIMEOUT_MS } from '../../src/search/constants.js';
import { INTENT_SYSTEM_PROMPT } from '../../src/search/prompt.js';
import { parseSearchIntent, withTimeout } from '../../src/search/intent.js';

afterEach(() => {
  setLLMProvider(undefined);
  nock.cleanAll();
  nock.enableNetConnect();
});

function chatReturning(content: string, counter?: { calls: number }, captured?: Parameters<LLMProvider['chat']>[0][]): LLMProvider {
  return {
    async chat(req) {
      if (counter) counter.calls += 1;
      captured?.push(req);
      return { content, model: 'mock', usage: { prompt: 1, completion: 1, total: 2 } };
    },
  };
}

describe('withTimeout', () => {
  it('到期 throw INTENT_TIMEOUT，且不留下悬挂 timer', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toMatchObject({
      name: 'RetryableLLMError',
      message: 'INTENT_TIMEOUT',
    });
  });

  it('先完成则返回值', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });
});

describe('parseSearchIntent（spec §3.1 / §3.3）', () => {
  const now = Date.parse('2026-08-29T04:00:00.000Z');

  it('空 provider：整句当 text，不调 chat', async () => {
    const spy = jest.fn<LLMProvider['chat']>();
    setLLMProvider({ chat: spy });
    setLLMProvider(null);
    const parsed = await parseSearchIntent('去年今天和外婆', -480, now);
    expect(parsed).toEqual({ personNames: [], place: null, time: null, text: '去年今天和外婆' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('合法 JSON：temperature=0 maxTokens=512；user prompt 含查看者日期与 tzOffset', async () => {
    const captured: Parameters<LLMProvider['chat']>[0][] = [];
    const body = {
      personNames: ['外婆'],
      place: null,
      time: { kind: 'wall_date', year: 2025, month: 8, day: 29 },
      text: '',
    };
    setLLMProvider(chatReturning(JSON.stringify(body), undefined, captured));
    const parsed = await parseSearchIntent('去年今天和外婆', -480, now);
    expect(parsed).toEqual(body);
    expect(captured[0].temperature).toBe(INTENT_CHAT_TEMPERATURE);
    expect(captured[0].maxTokens).toBe(INTENT_CHAT_MAX_TOKENS);
    expect(captured[0].messages[0].content).toBe(INTENT_SYSTEM_PROMPT);
    expect(captured[0].messages[1].content).toContain('去年今天和外婆');
    expect(captured[0].messages[1].content).toContain('2026-08-29');
    expect(captured[0].messages[1].content).toContain('-480');
  });

  it('畸形 JSON 降级且只调一次（不内部重试）', async () => {
    const counter = { calls: 0 };
    setLLMProvider(chatReturning('not-json', counter));
    await expect(parseSearchIntent('外婆', 0, now)).resolves.toEqual({
      personNames: [],
      place: null,
      time: null,
      text: '外婆',
    });
    expect(counter.calls).toBe(1);
  });

  it('RetryableLLMError / NonRetryableLLMError 降级', async () => {
    setLLMProvider({
      chat: async () => {
        throw new RetryableLLMError('429');
      },
    });
    await expect(parseSearchIntent('外婆', 0, now)).resolves.toMatchObject({ text: '外婆', personNames: [] });

    setLLMProvider({
      chat: async () => {
        throw new NonRetryableLLMError('400', 400);
      },
    });
    await expect(parseSearchIntent('外婆', 0, now)).resolves.toMatchObject({ text: '外婆' });
  });

  it(`超时 ${INTENT_TIMEOUT_MS}ms 降级（fake timers）`, async () => {
    jest.useFakeTimers();
    try {
      setLLMProvider({ chat: () => new Promise(() => undefined) });
      const p = parseSearchIntent('外婆', 0, now);
      await jest.advanceTimersByTimeAsync(INTENT_TIMEOUT_MS);
      await expect(p).resolves.toEqual({ personNames: [], place: null, time: null, text: '外婆' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('parseSearchIntent nock 钉 chat HTTP（spec §9）', () => {
  it('OpenAI 兼容 body 含 temperature 0 与系统 prompt', async () => {
    nock.disableNetConnect();
    const host = 'https://llm.test';
    const payload = {
      personNames: [],
      place: null,
      time: null,
      text: '野餐',
    };
    const scope = nock(host)
      .post('/v1/chat/completions', (body: { temperature?: number; max_tokens?: number; messages?: { content: string }[] }) => {
        expect(body.temperature).toBe(0);
        expect(body.max_tokens).toBe(512);
        expect(body.messages?.[0]?.content).toBe(INTENT_SYSTEM_PROMPT);
        expect(body.messages?.[1]?.content).toContain('野餐');
        return true;
      })
      .reply(200, { choices: [{ message: { content: JSON.stringify(payload) } }], model: 'm' });

    setLLMProvider(
      new OpenAICompatProvider({ baseUrl: `${host}/v1`, apiKey: 'sk-test', model: 'm', timeoutMs: 500 }),
    );
    await expect(parseSearchIntent('野餐', -480, Date.parse('2026-08-29T00:00:00Z'))).resolves.toEqual(payload);
    expect(scope.isDone()).toBe(true);
  });
});
