import type { AuthResponse, AuthTokens } from '@moment/dto';
import { ApiError, type MomentClientOptions, type PutFn, type TokenStore } from './types.js';

export { ApiError };
export type { MomentClientOptions, PutFn, TokenStore };

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 拼到 URL 上的查询参数（undefined 跳过；值会被 String() 化） */
  query?: Record<string, string | number | undefined>;
  /** true = 不附带 Authorization（refresh/login 等） */
  skipAuth?: boolean;
  /** true = 收到 401 也不触发 refresh（auth 端点自身，防循环） */
  skipAuthRefresh?: boolean;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = `请求失败（${res.status}）`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.details !== undefined) details = body.error.details;
  } catch {
    // 非 JSON 错误体：保留 HTTP_xxx 降级码
  }
  return new ApiError(message, res.status, code, details);
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** 低层 HTTP 封装：Bearer 附带、401 单飞 refresh + 重放一次、ApiError 透传。 */
export class Http {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private refreshPromise: Promise<string> | null = null;

  constructor(options: MomentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenStore = options.tokenStore;
    // bind: 裸取 window.fetch 后作 this.fetchImpl(...) 会丢 this，Chrome 抛 Illegal invocation
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const first = await this.doFetch(path, options);
    if (first.status === 401 && !options.skipAuth && !options.skipAuthRefresh) {
      // 只有「本次可能附带过 token」的请求才值得 refresh：store 里连 refreshToken 都没有
      // （即本来就没登录）时直接透传 401，不 refresh、不 clear——避免误清未登录态以外的状态。
      const refreshToken = await this.tokenStore.getRefreshToken();
      if (!refreshToken) throw await toApiError(first);
      const accessToken = await this.refresh(); // 单飞；失败抛 ApiError 并已 clear
      const second = await this.doFetch(path, options, accessToken);
      if (!second.ok) {
        // 只有重放仍 401 才意味着登录态真失效；403/404/410 等业务错误直接透传，不误清 token（不强制登出）。
        if (second.status === 401) await Promise.resolve(this.tokenStore.clear()).catch(() => undefined);
        throw await toApiError(second);
      }
      return parseBody<T>(second);
    }
    if (!first.ok) throw await toApiError(first);
    return parseBody<T>(first);
  }

  /** 拉取二进制（如 GET /api/media/:id：302 → 预签名对象，fetch 默认 follow 重定向，res.blob() 直接拿内容）。
   *  与 request 同一套 Bearer 附带 + 401 单飞 refresh + 重放一次语义，仅响应处理换成 blob()。 */
  async requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
    const first = await this.doFetch(path, options);
    if (first.status === 401) {
      const refreshToken = await this.tokenStore.getRefreshToken();
      if (!refreshToken) throw await toApiError(first);
      const accessToken = await this.refresh();
      const second = await this.doFetch(path, options, accessToken);
      if (!second.ok) {
        if (second.status === 401) await Promise.resolve(this.tokenStore.clear()).catch(() => undefined);
        throw await toApiError(second);
      }
      return second.blob();
    }
    if (!first.ok) throw await toApiError(first);
    return first.blob();
  }

  private async doFetch(path: string, options: RequestOptions, tokenOverride?: string): Promise<Response> {
    let token = tokenOverride;
    if (token === undefined && !options.skipAuth) {
      token = (await this.tokenStore.getAccessToken()) ?? undefined;
    }
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const url = buildUrl(this.baseUrl, path, options.query);
    try {
      return await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err instanceof Error ? err.message : '网络错误', 0, 'NETWORK_ERROR');
    }
  }

  /** 单飞 refresh：并发调用共享同一 promise；成功返回新 accessToken，失败 clear 并抛 ApiError。 */
  private refresh(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<string> {
    const refreshToken = await this.tokenStore.getRefreshToken();
    if (!refreshToken) {
      await Promise.resolve(this.tokenStore.clear()).catch(() => undefined);
      throw new ApiError('登录已过期', 401, 'NO_REFRESH_TOKEN');
    }
    const res = await this.doFetch('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      skipAuth: true,
      skipAuthRefresh: true,
    });
    if (!res.ok) {
      await Promise.resolve(this.tokenStore.clear()).catch(() => undefined);
      throw await toApiError(res);
    }
    const data = (await res.json()) as AuthResponse;
    await this.tokenStore.setTokens(data.tokens);
    return data.tokens.accessToken;
  }
}

export type { AuthTokens };
