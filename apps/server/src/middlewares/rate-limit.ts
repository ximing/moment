import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config.js';

const isTest = config.NODE_ENV === 'test';
const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };

/** IPv6 /56 归一化（v8 安全修复：防子网内轮换 IP 绕过限流）；IPv4 原样返回。导出供回归测试断言。 */
export function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '', 56);
}

/** 登录限流 key：归一化 IP + email（小写）。导出供回归测试断言确实走 ipKeyGenerator。 */
export function loginKeyGenerator(req: Request): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
  return `${ipKey(req)}:${email}`;
}

/** 邀请接受限流 key：归一化 IP + invitee userId + invite token。导出供回归测试断言。 */
export function inviteAcceptKeyGenerator(req: Request): string {
  const userId = (req as unknown as { user?: { id: string } }).user?.id ?? 'anonymous';
  const token = typeof req.params?.token === 'string' ? req.params.token : '';
  return `${ipKey(req)}:${userId}:${token}`;
}

/** 注册等敏感端点：IP 维度，60s/10 次。测试环境放宽避免用例互踩。 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

/** 登录：IP + 账号双维度（spec §4/§6），60s/5 次，防分布式 IP 爆破同一账号。 */
export const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginKeyGenerator,
  message,
});

/**
 * 邀请接受：IP + 账号（invitee）+ invite token 三维度（spec §4/§6），60s/5 次。
 * 只挂在 `POST /api/invites/:token/accept` 上（populateUser 之后注册，req.user 可读），
 * 不覆盖 DELETE /api/invites/:inviteId 的 owner 吊销操作。
 */
export const inviteAcceptRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: inviteAcceptKeyGenerator,
  message,
});

export const SEARCH_RATE_WINDOW_MS = 60_000;
export const SEARCH_RATE_LIMIT = 20;

export function searchKeyGenerator(req: Request): string {
  const userId = (req as unknown as { user?: { id: string } }).user?.id ?? 'anonymous';
  return `${ipKey(req)}:${userId}`;
}

export const searchRateLimiter = rateLimit({
  windowMs: SEARCH_RATE_WINDOW_MS,
  limit: isTest ? 1000 : SEARCH_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: searchKeyGenerator,
  message,
});

/** 匿名公开端点：IP 维度 60s/60 次（公开页一次浏览 = 1 次 API + N 次 media 302，媒体不走本 limiter）。 */
export const publicShareRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
