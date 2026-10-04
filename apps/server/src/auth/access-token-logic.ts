import { createHash, randomBytes } from "node:crypto";
import { ACCESS_TOKEN_PREFIX } from "@moment/dto";

export const ACCESS_TOKEN_BYTES = 32;

export function generateAccessToken(
  entropy: Buffer = randomBytes(ACCESS_TOKEN_BYTES),
): string {
  if (entropy.length !== ACCESS_TOKEN_BYTES) {
    throw new Error("access token entropy must be 32 bytes");
  }
  return `${ACCESS_TOKEN_PREFIX}${entropy.toString("base64url")}`;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 接口令牌和会话 JWT 都走 Bearer。先用前缀把令牌从 JWT 里分开，避免把 mmt_ 送进 jwt.verify。 */
export function isPersonalAccessToken(token: string): boolean {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return false;
  const body = token.slice(ACCESS_TOKEN_PREFIX.length);
  return body.length >= 40 && /^[A-Za-z0-9_-]+$/.test(body);
}

/** 前 8 位和后 4 位，中间换成 ***。短于可展示长度时只留开头。 */
export function previewAccessToken(token: string): string {
  if (token.length <= 14)
    return `${token.slice(0, Math.min(4, token.length))}***`;
  return `${token.slice(0, 8)}***${token.slice(-4)}`;
}
