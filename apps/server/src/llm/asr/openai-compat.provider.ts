import { NonRetryableLLMError, RetryableLLMError } from '../base.provider.js';
import type { ASRProvider, ASRTranscribeRequest } from './base.provider.js';

export interface OpenAICompatASRProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒，默认 60000（对齐 LLM provider） */
  timeoutMs?: number;
}

/** 白名单 mime → multipart filename 扩展名（ASR 端据此嗅探格式；dto AUDIO_MIME_TYPES 之外的 mime 不会到达这里） */
const EXT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/**
 * OpenAI 兼容 /audio/transcriptions 实现（spec voice-moment §4.1）。
 * 硅基流动 SenseVoice、百炼 OpenAI 兼容模式均吃这个端点形态。
 * 错误分类与 OpenAICompatProvider（chat）一致：429/5xx/网络/超时 → Retryable；其他 4xx → NonRetryable。
 */
export class OpenAICompatASRProvider implements ASRProvider {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAICompatASRProviderOptions) {
    const base = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
    this.url = `${base}/audio/transcriptions`;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async transcribe(req: ASRTranscribeRequest): Promise<{ text: string }> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(req.audio)], { type: req.mime }),
      `audio.${EXT_BY_MIME[req.mime] ?? 'bin'}`,
    );
    form.append('model', this.opts.model);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new RetryableLLMError(
        err instanceof Error && err.name === 'AbortError'
          ? `ASR request timed out after ${this.timeoutMs}ms`
          : `ASR network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (resp.status === 429 || resp.status >= 500) {
      throw new RetryableLLMError(`ASR ${resp.status}: ${resp.statusText}`);
    }
    if (resp.status >= 400) {
      throw new NonRetryableLLMError(`ASR ${resp.status}: ${resp.statusText}`, resp.status);
    }

    const data = (await resp.json().catch(() => null)) as { text?: unknown } | null;
    if (!data || typeof data.text !== 'string') {
      throw new NonRetryableLLMError('ASR response missing text', resp.status);
    }
    return { text: data.text };
  }
}
