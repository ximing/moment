/**
 * LLM Provider 接口（spec §3）。
 * 与 storage adapter（CONVENTIONS §3.3）同范式：接口 + 默认实现 + factory 单例。
 * 调用方（T3 generateRecap）通过依赖注入接收 provider，测试用 mock provider 注入。
 */
export interface LLMChatRequest {
  messages: { role: 'system' | 'user'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMChatResponse {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
}

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type LLMAgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: { id: string; name: string; arguments: string }[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type LLMAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'done' };

export interface LLMAgentChatRequest {
  messages: LLMAgentMessage[];
  tools?: LLMToolDef[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(req: LLMChatRequest): Promise<LLMChatResponse>;
  /** 可选。没有此方法的测试替身不受影响；Agent 发送因此走 503。 */
  agentChat?(req: LLMAgentChatRequest): AsyncGenerator<LLMAgentEvent>;
}

/**
 * 可重试错误（spec §3：429/5xx/网络/超时）。
 * outbox handler（T4）捕获此类错误时走指数退避重试。
 */
export class RetryableLLMError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableLLMError';
  }
}

/**
 * 不可重试错误（spec §3：4xx 其他）。
 * outbox handler（T4）捕获此类错误时直接标记 failed，不重试。
 */
export class NonRetryableLLMError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableLLMError';
  }
}
