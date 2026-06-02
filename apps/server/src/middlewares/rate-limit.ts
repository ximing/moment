import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const isTest = config.NODE_ENV === 'test';
const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };

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
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
    return `${req.ip}:${email}`;
  },
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
  keyGenerator: (req) => {
    const userId = (req as unknown as { user?: { id: string } }).user?.id ?? 'anonymous';
    const token = typeof req.params?.token === 'string' ? req.params.token : '';
    return `${req.ip}:${userId}:${token}`;
  },
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
