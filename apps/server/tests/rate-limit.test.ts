import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import express from 'express';
import request from 'supertest';
import { inviteAcceptKeyGenerator, loginKeyGenerator } from '../src/middlewares/rate-limit.js';
import { listenLocalReady } from './helpers/http-server.js';

// 不依赖 NODE_ENV 的单元级验证：限流中间件本身在超限后返回 429。
describe('rate limit 行为', () => {
  it('超过 limit 后返回 429', async () => {
    const app = express();
    app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    const server = await listenLocalReady(app);

    expect((await request(server).get('/x')).status).toBe(200);
    expect((await request(server).get('/x')).status).toBe(200);
    expect((await request(server).get('/x')).status).toBe(429);
  });
});

describe('ipKeyGenerator（v8，IPv6 /56 归一化）', () => {
  it('同一 /56 子网内不同 IPv6 地址归并为同一 key；IPv4 原样返回', () => {
    const a = ipKeyGenerator('0123:4567:89ab:cd11:1111:1111:1111:1111', 56);
    const b = ipKeyGenerator('0123:4567:89ab:cd22:2222:2222:2222:2222', 56);
    expect(a).toBe(b);
    expect(ipKeyGenerator('203.0.113.7', 56)).toBe('203.0.113.7');
  });
});

describe('limiter keyGenerator 回归（修复 IPv6 /56 绕过：断言 limiter 确实走 ipKeyGenerator）', () => {
  // 同一 /56 子网（前 56 bit 相同）的两个地址
  const ipA = '0123:4567:89ab:cd11:1111:1111:1111:1111';
  const ipB = '0123:4567:89ab:cd22:2222:2222:2222:2222';

  it('loginKeyGenerator：同 /56 两地址 + 同 email（大小写不敏感）→ 同 key；email 参与 key', () => {
    const k1 = loginKeyGenerator({ ip: ipA, body: { email: 'A@b.com' } } as never);
    const k2 = loginKeyGenerator({ ip: ipB, body: { email: 'a@b.com' } } as never);
    expect(k1).toBe(k2);
    expect(loginKeyGenerator({ ip: ipA, body: { email: 'x@b.com' } } as never)).not.toBe(k1);
  });

  it('inviteAcceptKeyGenerator：同 /56 两地址（同 user/token）→ 同 key', () => {
    const base = { body: {}, params: { token: 't-1' }, user: { id: 'u-1' } };
    expect(inviteAcceptKeyGenerator({ ...base, ip: ipA } as never)).toBe(
      inviteAcceptKeyGenerator({ ...base, ip: ipB } as never)
    );
  });
});
