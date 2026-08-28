import { NonRetryableLLMError, RetryableLLMError } from '../llm/base.provider.js';
import type { GeocodeProvider } from './base.provider.js';
import { wgs84ToGcj02 } from './gcj02.js';

/** 高德 Web 服务 v3 逆地理编码端点（计划偏差 7：常量而非环境变量） */
export const AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo';

export interface AmapProviderOptions {
  apiKey: string;
  /** 请求超时毫秒，默认 10000（计划偏差 8：regeo 轻量同步接口，10s） */
  timeoutMs?: number;
}

/** 高德 regeo 响应体的局部形状 */
interface AmapRegeoResponse {
  /** 业务状态：字符串 "1" 才是成功 */
  status?: unknown;
  info?: unknown;
  regeocode?: { formatted_address?: unknown };
}

/**
 * 高德逆地理编码实现（spec §4）。
 * GET {AMAP_REGEO_URL}?key=...&location=lng,lat
 * - 入参 WGS-84，**先 wgs84ToGcj02 换算再拼接**（境外点换算函数原值返回，即「境外不偏移直接请求」）
 * - location 顺序 **lng 在前**、6 位小数（高德文档 location 规则）
 * - 取 regeocode.formatted_address
 * 错误语义（计划偏差 3）：status!=="1"/HTTP 4xx 非 429/JSON 畸形 → NonRetryableLLMError；
 * HTTP 429/5xx/网络/超时 → RetryableLLMError；status==="1" 但无非空 formatted_address → null。
 */
export class AmapProvider implements GeocodeProvider {
  private readonly timeoutMs: number;

  constructor(private readonly opts: AmapProviderOptions) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const gcj = wgs84ToGcj02(lat, lng);
    const url =
      `${AMAP_REGEO_URL}?key=${encodeURIComponent(this.opts.apiKey)}` +
      `&location=${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'GET', signal: controller.signal });
    } catch (err) {
      // AbortError（超时）或网络错误（ECONNREFUSED 等）都是可重试的（对齐 openai-compat.provider 范式）
      clearTimeout(timer);
      throw new RetryableLLMError(
        err instanceof Error && err.name === 'AbortError'
          ? `geocode request timed out after ${this.timeoutMs}ms`
          : `geocode network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (resp.status === 429 || resp.status >= 500) {
      throw new RetryableLLMError(`geocode HTTP ${resp.status}: ${resp.statusText}`);
    }
    if (resp.status >= 400) {
      throw new NonRetryableLLMError(`geocode HTTP ${resp.status}: ${resp.statusText}`, resp.status);
    }

    const data = await safeJson(resp);
    if (!data) {
      throw new NonRetryableLLMError('geocode returned invalid JSON', resp.status);
    }
    if (data.status !== '1') {
      // 高德业务失败（INVALID_USER_KEY / DAILY_QUERY_OVER_LIMIT / CUQPS 限流等）。
      // 注意：这里分类为 NonRetryable 仅是 HTTP provider 范式的错误类型标注——
      // geocode handler 对所有抛出一律传播退避（见 handlers.ts 的 handleMomentGeocode 注释）。
      throw new NonRetryableLLMError(
        `geocode amap status ${String(data.status)}: ${String(data.info ?? 'unknown')}`,
        resp.status,
      );
    }

    const address = data.regeocode?.formatted_address;
    // status=1 但拿不到非空地址 → 确定无结果（null），不抛错不重试（计划偏差 3）
    if (typeof address !== 'string' || address.length === 0) return null;
    return address;
  }
}

/** 安全解析 JSON 响应体，失败返回 null */
async function safeJson(resp: Response): Promise<AmapRegeoResponse | null> {
  try {
    return (await resp.json()) as AmapRegeoResponse;
  } catch {
    return null;
  }
}
