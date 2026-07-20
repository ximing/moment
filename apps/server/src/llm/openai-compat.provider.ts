import type { LLMChatRequest, LLMChatResponse, LLMProvider } from './base.provider.js';
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
