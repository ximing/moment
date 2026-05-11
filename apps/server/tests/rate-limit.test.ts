import rateLimit from 'express-rate-limit';
import express from 'express';
import request from 'supertest';

// 不依赖 NODE_ENV 的单元级验证：限流中间件本身在超限后返回 429。
describe('rate limit 行为', () => {
  it('超过 limit 后返回 429', async () => {
    const app = express();
    app.use(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }));
    app.get('/x', (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(429);
  });
});
