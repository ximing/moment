import { NonRetryableLLMError, RetryableLLMError } from '../base.provider.js';
import type { ASRProvider, ASRTranscribeRequest } from './base.provider.js';

export const DASHSCOPE_POLL_INTERVAL_MS = 2_000;
export const DASHSCOPE_TRANSCRIBE_TIMEOUT_MS = 300_000;

interface DashScopeASRProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** DashScope fun-asr 非实时异步任务 provider（spec voice-moment §4.1）。 */
export class DashScopeASRProvider implements ASRProvider {
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly opts: DashScopeASRProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.pollIntervalMs = opts.pollIntervalMs ?? DASHSCOPE_POLL_INTERVAL_MS;
    this.timeoutMs = opts.timeoutMs ?? DASHSCOPE_TRANSCRIBE_TIMEOUT_MS;
  }

  async transcribe(req: ASRTranscribeRequest): Promise<{ text: string }> {
    const fileUrl = httpUrl(req.fileUrl);
    if (!fileUrl) {
      throw new NonRetryableLLMError('ASR source URL must use HTTP or HTTPS', 400);
    }

    const deadline = Date.now() + this.timeoutMs;
    const submitted = await this.requestJson(
      `${this.baseUrl}/services/audio/asr/transcription`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: this.opts.model,
          input: { file_urls: [fileUrl] },
          parameters: {},
        }),
      },
      deadline,
      'submit',
    );
    const submitOutput = isObject(submitted.output) ? submitted.output : null;
    const taskId = submitOutput?.task_id;
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
      throw new NonRetryableLLMError('ASR submit response missing output.task_id', 200);
    }

    while (true) {
      await this.waitForNextPoll(deadline);
      const task = await this.requestJson(
        `${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.opts.apiKey}` },
        },
        deadline,
        `poll task ${taskId}`,
      );
      const output = isObject(task.output) ? task.output : null;
      if (!output) {
        throw new NonRetryableLLMError(`ASR task ${taskId} response missing output`, 200);
      }
      const status = output.task_status;

      if (status === 'PENDING' || status === 'RUNNING') continue;
      if (status === 'FAILED') {
        const failure = this.taskFailure(task, output);
        this.throwTaskFailure(taskId, failure.code, failure.message);
      }
      if (status !== 'SUCCEEDED') {
        throw new NonRetryableLLMError(
          `ASR task ${taskId} has invalid task_status: ${String(status)}`,
          200,
        );
      }

      const results = output.results;
      if (!Array.isArray(results) || results.length !== 1 || !isObject(results[0])) {
        throw new NonRetryableLLMError(
          `ASR task ${taskId} must contain exactly one result`,
          200,
        );
      }
      const result = results[0];
      if (result.subtask_status === 'FAILED') {
        this.throwTaskFailure(taskId, result.code, result.message);
      }
      if (result.subtask_status !== 'SUCCEEDED') {
        throw new NonRetryableLLMError(
          `ASR task ${taskId} has invalid subtask_status: ${String(result.subtask_status)}`,
          200,
        );
      }
      const transcriptionUrl = httpUrl(result.transcription_url);
      if (!transcriptionUrl) {
        throw new NonRetryableLLMError(
          `ASR task ${taskId} has invalid transcription_url`,
          200,
        );
      }

      const transcription = await this.requestJson(
        transcriptionUrl,
        { method: 'GET' },
        deadline,
        `result task ${taskId}`,
      );
      if (!Array.isArray(transcription.transcripts)) {
        throw new NonRetryableLLMError(
          `ASR task ${taskId} result missing transcripts`,
          200,
        );
      }
      const texts = transcription.transcripts.map((item) =>
        isObject(item) && typeof item.text === 'string' ? item.text : null,
      );
      if (texts.some((text) => text === null)) {
        throw new NonRetryableLLMError(
          `ASR task ${taskId} result contains invalid transcript text`,
          200,
        );
      }
      return { text: (texts as string[]).join('\n') };
    }
  }

  private taskFailure(task: JsonObject, output: JsonObject): { code: unknown; message: unknown } {
    const results = output.results;
    const failedResult = Array.isArray(results)
      ? results.find((result) => isObject(result) && result.subtask_status === 'FAILED')
      : undefined;
    return {
      code: isObject(failedResult) ? failedResult.code : (output.code ?? task.code),
      message: isObject(failedResult) ? failedResult.message : (output.message ?? task.message),
    };
  }

  private throwTaskFailure(taskId: string, codeValue: unknown, messageValue: unknown): never {
    const code = typeof codeValue === 'string' && codeValue ? codeValue : 'UNKNOWN';
    const message = typeof messageValue === 'string' && messageValue ? messageValue : 'unknown error';
    const detail = `ASR task ${taskId} failed: ${code} - ${message}`;
    if (code === 'FILE_DOWNLOAD_FAILED') throw new RetryableLLMError(detail);
    throw new NonRetryableLLMError(detail, 200);
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    deadline: number,
    phase: string,
  ): Promise<JsonObject> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) this.throwTimeout();

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RetryableLLMError(`ASR transcription timed out after ${this.timeoutMs}ms`));
      }, remainingMs);
    });
    const request = (async (): Promise<JsonObject> => {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) this.throwTimeout();
        throw new RetryableLLMError(
          `ASR ${phase} network error: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
      }

      if (response.status === 429 || response.status >= 500) {
        throw new RetryableLLMError(`ASR ${phase} HTTP ${response.status}: ${response.statusText}`);
      }
      if (!response.ok) {
        throw new NonRetryableLLMError(
          `ASR ${phase} HTTP ${response.status}: ${response.statusText}`,
          response.status,
        );
      }
      let responseText: string;
      try {
        responseText = await response.text();
      } catch (error) {
        if (controller.signal.aborted) this.throwTimeout();
        throw new RetryableLLMError(
          `ASR ${phase} response body network error: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error,
        );
      }
      let data: unknown;
      try {
        data = JSON.parse(responseText) as unknown;
      } catch (error) {
        throw new NonRetryableLLMError(`ASR ${phase} returned invalid JSON`, response.status, error);
      }
      if (!isObject(data)) {
        throw new NonRetryableLLMError(`ASR ${phase} returned malformed JSON`, response.status);
      }
      return data;
    })();

    try {
      return await Promise.race([request, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async waitForNextPoll(deadline: number): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) this.throwTimeout();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(this.pollIntervalMs, remainingMs));
    });
    if (Date.now() >= deadline) this.throwTimeout();
  }

  private throwTimeout(): never {
    throw new RetryableLLMError(`ASR transcription timed out after ${this.timeoutMs}ms`);
  }
}
