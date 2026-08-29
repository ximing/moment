import { config } from '../config.js';

const HOUR_MS = 3_600_000;
const HOUR_SECONDS = 3600;

export interface AlignedGetPresign {
  /** 签名时刻（= 当前小时窗起点）：SigV4 预签名 URL 的 X-Amz-Date 来源 */
  signingDate: Date;
  /** 预签名有效期（秒）：TTL + 3600 常量 */
  expiresIn: number;
}

/**
 * 预签名 GET 整点对齐（spec §5.3）：**签名时刻**与**有效期**双对齐。
 * 只对齐过期时刻（expiresIn 随当前秒变化）是不够的——X-Amz-Date 进了签名输入，
 * 签名时刻每秒不同则 URL 字符串每秒不同，「同一窗口内 URL 相同」不成立。
 * 这里 signingDate = 窗口起点（常量）、expiresIn = TTL + 3600（常量）：
 * 窗内两次签名输入完全一致 → URL 字符串完全一致；距窗内任意时刻剩余 ≥ TTL。
 */
export function alignedGetPresign(
  nowMs = Date.now(),
  ttlSeconds = config.PRESIGN_GET_TTL_SECONDS
): AlignedGetPresign {
  const windowStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return { signingDate: new Date(windowStart), expiresIn: ttlSeconds + HOUR_SECONDS };
}
