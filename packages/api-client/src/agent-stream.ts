import type { AgentSseEvent, PostAgentTurnInput } from '@moment/dto';
import { ApiError } from './types.js';
import { Http, responseError } from './http.js';
import { createSseParser } from './sse.js';

export interface StreamAttempt {
  status: number;
  contentType: string;
  discard(): Promise<void>;
  error(): Promise<ApiError>;
  read(onChunk: (chunk: string) => void): Promise<void>;
}

export async function readAgentTurn(options: {
  http: Http;
  fetchImpl: typeof fetch;
  baseUrl: string;
  threadId: string;
  input: PostAgentTurnInput;
  signal?: AbortSignal;
  transport: 'fetch' | 'xhr';
  onEvent: (event: AgentSseEvent) => void;
}): Promise<void> {
  const path = `/api/agent/threads/${options.threadId}/turns`;
  const url = `${options.baseUrl}${path}`;
  const body = JSON.stringify(options.input);
  const open = (token: string | undefined): Promise<StreamAttempt> =>
    options.transport === 'xhr'
      ? xhrAttempt(url, token, body, options.signal)
      : fetchAttempt(options.fetchImpl, url, token, body, options.signal);

  let token = await options.http.accessToken();
  let attempt = await open(token);
  if (attempt.status === 401) {
    let next: string | null;
    try {
      next = await options.http.recoverFrom401();
    } catch (err) {
      await attempt.discard();
      throw err;
    }
    if (!next) throw await attempt.error();
    await attempt.discard();
    token = next;
    attempt = await open(token);
    if (attempt.status === 401) {
      await options.http.clearTokens();
      throw await attempt.error();
    }
  }

  const contentType = attempt.contentType.toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    throw await attempt.error();
  }
  const parser = createSseParser();
  await attempt.read((chunk) => {
    for (const event of parser.push(chunk)) options.onEvent(event);
  });
}

async function fetchAttempt(
  fetchImpl: typeof fetch,
  url: string,
  token: string | undefined,
  body: string,
  signal: AbortSignal | undefined,
): Promise<StreamAttempt> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method: 'POST', headers, body };
  if (signal) init.signal = signal;
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError(err instanceof Error ? err.message : '网络错误', 0, 'NETWORK_ERROR');
  }
  const status = res.status;
  const contentType = res.headers.get('content-type') ?? '';
  return {
    status,
    contentType,
    async discard() {
      await res.body?.cancel().catch(() => undefined);
    },
    error: () => responseError(res),
    async read(onChunk) {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const onAbort = (): void => {
        void reader.cancel().catch(() => undefined);
      };
      signal?.addEventListener('abort', onAbort);
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          onChunk(decoder.decode(chunk.value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) onChunk(tail);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

function xhrAttempt(url: string, token: string | undefined, body: string, signal?: AbortSignal): Promise<StreamAttempt> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new ApiError('当前环境没有 XMLHttpRequest', 0, 'NETWORK_ERROR'));
      return;
    }
    const xhr = new XMLHttpRequest();
    let settled = false;
    let seen = 0;
    let onChunk: ((chunk: string) => void) | null = null;
    let readDone: (() => void) | null = null;
    let readFail: ((err: unknown) => void) | null = null;
    let loadWait: (() => void) | null = null;

    const fail = (err: unknown): void => {
      if (readFail) {
        readFail(err);
        readFail = null;
        return;
      }
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    const emit = (): void => {
      if (!onChunk) return;
      const text = xhr.responseText ?? '';
      if (text.length <= seen) return;
      const next = text.slice(seen);
      seen = text.length;
      onChunk(next);
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (signal) {
      if (signal.aborted) {
        fail(abortError());
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.onabort = () => fail(abortError());
    xhr.onerror = () => fail(new ApiError('网络错误', 0, 'NETWORK_ERROR'));
    xhr.onprogress = () => emit();
    xhr.onload = () => {
      emit();
      loadWait?.();
      readDone?.();
    };
    xhr.onreadystatechange = () => {
      if (settled || xhr.readyState < XMLHttpRequest.HEADERS_RECEIVED) return;
      settled = true;
      resolve({
        status: xhr.status,
        contentType: xhr.getResponseHeader('content-type') ?? '',
        async discard() {
          xhr.abort();
        },
        async error() {
          if (xhr.readyState < XMLHttpRequest.DONE) {
            await new Promise<void>((done) => {
              loadWait = done;
            });
          }
          return errorFromText(xhr.status, xhr.responseText ?? '');
        },
        read(cb) {
          return new Promise<void>((done, rejectRead) => {
            onChunk = cb;
            readDone = done;
            readFail = rejectRead;
            emit();
            if (xhr.readyState === XMLHttpRequest.DONE) done();
          });
        },
      });
    };
    xhr.send(body);
  });
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

async function errorFromText(status: number, text: string): Promise<ApiError> {
  let code = `HTTP_${status}`;
  let message = `请求失败（${status}）`;
  let details: unknown;
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.details !== undefined) details = body.error.details;
  } catch {
    // 非 JSON：保留 HTTP_xxx
  }
  return new ApiError(message, status, code, details);
}
