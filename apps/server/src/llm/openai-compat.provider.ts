import type {
  LLMAgentChatRequest,
  LLMAgentEvent,
  LLMAgentMessage,
  LLMChatRequest,
  LLMChatResponse,
  LLMProvider,
} from './base.provider.js';
import { NonRetryableLLMError, RetryableLLMError } from './base.provider.js';

// 便捷再导出：调用方（T3 generate / 测试）从 provider 模块一并取错误类，无需分别 import base。
export { NonRetryableLLMError, RetryableLLMError };

export interface OpenAICompatProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒，默认 60000（spec §3） */
  timeoutMs?: number;
}

/**
 * OpenAI 兼容 chat/completions 实现（spec §3）。
 * 支持 DeepSeek/通义/Moonshot 等 OpenAI 协议兼容端点。
 * POST {baseUrl}/chat/completions，Bearer apiKey，body 带 model。
 * 错误分类：429/5xx/网络/超时 → RetryableLLMError；4xx 其他 → NonRetryableLLMError。
 */
export class OpenAICompatProvider implements LLMProvider {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAICompatProviderOptions) {
    // baseUrl 末尾可能带 / 也可能不带，统一拼接
    const base = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
    this.url = `${base}/chat/completions`;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async chat(req: LLMChatRequest): Promise<LLMChatResponse> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
    };
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError（超时）或网络错误（ECONNREFUSED 等）都是可重试的
      clearTimeout(timer);
      throw new RetryableLLMError(
        err instanceof Error && err.name === 'AbortError'
          ? `LLM request timed out after ${this.timeoutMs}ms`
          : `LLM network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    // 429/5xx → RetryableLLMError
    if (resp.status === 429 || resp.status >= 500) {
      const errBody = await safeJson(resp);
      throw new RetryableLLMError(
        `LLM ${resp.status}: ${errBody?.error?.message ?? resp.statusText}`,
      );
    }

    // 4xx 其他 → NonRetryableLLMError
    if (resp.status >= 400) {
      const errBody = await safeJson(resp);
      throw new NonRetryableLLMError(
        `LLM ${resp.status}: ${errBody?.error?.message ?? resp.statusText}`,
        resp.status,
      );
    }

    // 200 但 choices 缺失/空 → NonRetryableLLMError（畸形响应，不重试）
    const data = await safeJson(resp);
    if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
      throw new NonRetryableLLMError(
        'LLM response missing choices array',
        resp.status,
      );
    }

    const choice = data.choices[0] as { message?: { content?: string } };
    const content = choice.message?.content;
    if (typeof content !== 'string') {
      throw new NonRetryableLLMError(
        'LLM response missing message.content',
        resp.status,
      );
    }

    return {
      content,
      model: typeof data.model === 'string' ? data.model : this.opts.model,
      usage: {
        prompt: Number(data.usage?.prompt_tokens ?? 0),
        completion: Number(data.usage?.completion_tokens ?? 0),
        total: Number(data.usage?.total_tokens ?? 0),
      },
    };
  }

  /**
   * 流式 tool calling。不改 chat()。
   * 文本 delta 随到随产出；tool_calls 按 index 拼完，流结束后再产出完整 tool_call，然后 done。
   * 超时用调用方 signal 与本 provider 的 timeoutMs（默认 60s）一起 abort。
   */
  async *agentChat(req: LLMAgentChatRequest): AsyncGenerator<LLMAgentEvent> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: toOpenAIMessages(req.messages),
      stream: true,
    };
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.tools !== undefined) {
      body['tools'] = req.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw mapStreamNetworkError(err, this.timeoutMs, timeoutSignal);
    }

    if (resp.status === 429 || resp.status >= 500) {
      const errBody = await safeJson(resp);
      throw new RetryableLLMError(`LLM ${resp.status}: ${errBody?.error?.message ?? resp.statusText}`);
    }
    if (resp.status >= 400) {
      const errBody = await safeJson(resp);
      throw new NonRetryableLLMError(
        `LLM ${resp.status}: ${errBody?.error?.message ?? resp.statusText}`,
        resp.status,
      );
    }
    if (!resp.body) {
      throw new NonRetryableLLMError('LLM response missing body', resp.status);
    }

    yield* parseOpenAIStream(resp.body);
  }
}

function toOpenAIMessages(messages: LLMAgentMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function mapStreamNetworkError(err: unknown, timeoutMs: number, timeoutSignal: AbortSignal): RetryableLLMError {
  const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
  if (timeoutSignal.aborted) {
    return new RetryableLLMError(`LLM request timed out after ${timeoutMs}ms`, err);
  }
  if (aborted) return new RetryableLLMError('LLM request aborted', err);
  return new RetryableLLMError(
    `LLM network error: ${err instanceof Error ? err.message : String(err)}`,
    err,
  );
}

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

interface OpenAIStreamDelta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

function* yieldToolCalls(tools: Map<number, ToolCallAcc>): Generator<LLMAgentEvent> {
  for (const index of [...tools.keys()].sort((a, b) => a - b)) {
    const tool = tools.get(index)!;
    yield { type: 'tool_call', id: tool.id, name: tool.name, arguments: tool.arguments };
  }
}

/** 解析一行 SSE。返回 text 事件、finish（遇到 [DONE]）或 null（注释/空行/无内容 delta）。 */
function takeSseLine(line: string, tools: Map<number, ToolCallAcc>): LLMAgentEvent | 'finish' | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') return 'finish';
  let json: { choices?: Array<{ delta?: OpenAIStreamDelta }> };
  try {
    json = JSON.parse(data) as { choices?: Array<{ delta?: OpenAIStreamDelta }> };
  } catch (err) {
    throw new NonRetryableLLMError('LLM stream JSON malformed', 200, err);
  }
  const delta = json.choices?.[0]?.delta;
  if (!delta) return null;
  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      const index = typeof call.index === 'number' ? call.index : 0;
      const acc = tools.get(index) ?? { id: '', name: '', arguments: '' };
      if (typeof call.id === 'string') acc.id += call.id;
      if (typeof call.function?.name === 'string') acc.name += call.function.name;
      if (typeof call.function?.arguments === 'string') acc.arguments += call.function.arguments;
      tools.set(index, acc);
    }
  }
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    return { type: 'text', text: delta.content };
  }
  return null;
}

async function* parseOpenAIStream(body: ReadableStream<Uint8Array>): AsyncGenerator<LLMAgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const tools = new Map<number, ToolCallAcc>();
  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (err) {
        const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        throw new RetryableLLMError(
          aborted ? 'LLM request aborted' : `LLM network error: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const taken = takeSseLine(line, tools);
        if (taken === 'finish') {
          yield* yieldToolCalls(tools);
          yield { type: 'done' };
          return;
        }
        if (taken) yield taken;
        nl = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield* yieldToolCalls(tools);
  yield { type: 'done' };
}

/** OpenAI 兼容响应体的局部形状（error / choices / model / usage）。 */
type OpenAIResponseJson = {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: string } }>;
  model?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/** 安全解析 JSON 响应体，失败返回 null */
async function safeJson(resp: Response): Promise<OpenAIResponseJson | null> {
  try {
    return (await resp.json()) as OpenAIResponseJson;
  } catch {
    return null;
  }
}
