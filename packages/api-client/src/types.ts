import type { AuthTokens } from '@moment/dto';

/** token 持久化接口：web 用 localStorage 实现、app 用 expo-secure-store 实现（各自在自己的 app 包里提供）。 */
export interface TokenStore {
  getAccessToken(): Promise<string | null> | string | null;
  getRefreshToken(): Promise<string | null> | string | null;
  setTokens(tokens: AuthTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

/** 服务端统一错误体 {error:{code,message,details?}} 的客户端形态。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** RN 等无法把整文件读入内存的环境：不传 Blob，改传文件 uri + 字节区间，由注入的 put 实现按片读盘。
 *  （Phase 7 评审引入的最小契约扩展：500MB 视频整读入内存真机 OOM。带 size 使其与 Blob 在
 *  `body.size` 上结构同型，既有 fake/默认实现无需分支。） */
export interface FilePart {
  fileUri: string;
  start: number;
  end: number;
  size: number;
  mime: string;
}

/** 直传 PUT（带上传进度）。默认实现是浏览器 XHR（只接受 Blob）；node 测试注入 fake；RN 注入自定义实现（可按 FilePart 读盘）。 */
export type PutFn = (
  url: string,
  body: Blob | FilePart,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
) => Promise<{ etag: string | null }>;

export interface MomentClientOptions {
  /** API 根地址，如 ''（同源）或 'https://api.example.com' */
  baseUrl: string;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  putWithProgress?: PutFn;
}
