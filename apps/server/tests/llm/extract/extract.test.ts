import { setLLMProvider } from '../../../src/llm/factory.js';
import {
  NonRetryableLLMError,
  RetryableLLMError,
  type LLMChatRequest,
  type LLMProvider,
} from '../../../src/llm/base.provider.js';
import { extractPersonsPlaces, parseExtractJson } from '../../../src/llm/extract/extract.js';

/** mock provider 工厂：chat 返回指定原始 content，记录调用次数与请求（对齐 recap generate.test 范式）。 */
function chatReturning(
  content: string,
  counter?: { calls: number },
  captured?: LLMChatRequest[],
): LLMProvider {
  return {
    async chat(req) {
      if (counter) counter.calls += 1;
      captured?.push(req);
      return { content, model: 'mock-model', usage: { prompt: 10, completion: 5, total: 15 } };
    },
  };
}

describe('parseExtractJson（对齐 recap parseRecapJson 防御范式，spec people-place §5）', () => {
  it('合法 JSON {persons, places}', () => {
    expect(parseExtractJson('{"persons":["外婆"],"places":["朝阳公园"]}')).toEqual({
      persons: ['外婆'],
      places: ['朝阳公园'],
    });
  });

  it('markdown 代码块包裹容错（```json ... ```）', () => {
    expect(parseExtractJson('```json\n{"persons":[],"places":[]}\n```')).toEqual({
      persons: [],
      places: [],
    });
  });

  it('空数组合法（没有人物/地点，spec §5）', () => {
    expect(parseExtractJson('{"persons":[],"places":[]}')).toEqual({ persons: [], places: [] });
  });

  it('persons/places 缺失或非数组 → null', () => {
    expect(parseExtractJson('{"persons":[]}')).toBeNull();
    expect(parseExtractJson('{"places":[]}')).toBeNull();
    expect(parseExtractJson('{"persons":"外婆","places":[]}')).toBeNull();
    expect(parseExtractJson('{"persons":{},"places":[]}')).toBeNull();
  });

  it('非字符串成员与空白串过滤（防 number/boolean 混入与空名）', () => {
    const r = parseExtractJson('{"persons":["外婆", 1, null, "  "],"places":["北京", true]}');
    expect(r).toEqual({ persons: ['外婆'], places: ['北京'] });
  });

  it('非 JSON → null', () => {
    expect(parseExtractJson('not json')).toBeNull();
    expect(parseExtractJson('')).toBeNull();
  });
});

describe('extractPersonsPlaces（spec people-place §5）', () => {
  it('正常路径：system+user 两条消息调 provider，解析 persons/places', async () => {
    const counter = { calls: 0 };
    const captured: LLMChatRequest[] = [];
    const provider = chatReturning('{"persons":["外婆","朵朵"],"places":["外婆家"]}', counter, captured);

    const result = await extractPersonsPlaces('在外婆家', null, { provider });

    expect(result).toEqual({ persons: ['外婆', '朵朵'], places: ['外婆家'] });
    expect(counter.calls).toBe(1);
    expect(captured[0].messages).toHaveLength(2);
    expect(captured[0].messages[0].role).toBe('system');
    expect(captured[0].messages[0].content).toContain('persons');
    expect(captured[0].messages[1].role).toBe('user');
    expect(captured[0].messages[1].content).toContain('在外婆家'); // 素材进 user prompt
  });

  it('空数组输出合法（无人物无地点）', async () => {
    const result = await extractPersonsPlaces('普通正文', null, {
      provider: chatReturning('{"persons":[],"places":[]}'),
    });
    expect(result).toEqual({ persons: [], places: [] });
  });

  it('畸形输出重试一次：第一次畸形、第二次合法 → 返回结果、共调 2 次（recap 范式）', async () => {
    const counter = { calls: 0 };
    let first = true;
    const provider: LLMProvider = {
      async chat() {
        counter.calls += 1;
        const content = first ? 'not json {' : '{"persons":["外婆"],"places":[]}';
        first = false;
        return { content, model: 'mock-model', usage: { prompt: 1, completion: 1, total: 2 } };
      },
    };

    const result = await extractPersonsPlaces('正文', null, { provider });
    expect(result).toEqual({ persons: ['外婆'], places: [] });
    expect(counter.calls).toBe(2);
  });

  it('畸形输出两次均失败 → 抛 NonRetryableLLMError 传播（processor 退避兜底，偏差 5）', async () => {
    const counter = { calls: 0 };
    const provider = chatReturning('still not json', counter);

    await expect(extractPersonsPlaces('正文', null, { provider })).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
    expect(counter.calls).toBe(2);
  });

  it('opts.provider 为 null（调用方违约，handler 应先行跳过）→ 抛 NonRetryableLLMError', async () => {
    await expect(extractPersonsPlaces('正文', null, { provider: null })).rejects.toBeInstanceOf(
      NonRetryableLLMError,
    );
  });

  it('provider.chat 抛 RetryableLLMError → 原样传播、不做内部重试（outbox 退避负责）', async () => {
    const counter = { calls: 0 };
    const provider: LLMProvider = {
      async chat() {
        counter.calls += 1;
        throw new RetryableLLMError('LLM 429');
      },
    };

    await expect(extractPersonsPlaces('正文', null, { provider })).rejects.toBeInstanceOf(
      RetryableLLMError,
    );
    expect(counter.calls).toBe(1);
  });

  it('opts.provider 缺省走 getLLMProvider()（setLLMProvider 注入生效）', async () => {
    setLLMProvider(chatReturning('{"persons":[],"places":[]}'));
    try {
      expect(await extractPersonsPlaces('正文', null)).toEqual({ persons: [], places: [] });
    } finally {
      setLLMProvider(undefined);
    }
  });
});
