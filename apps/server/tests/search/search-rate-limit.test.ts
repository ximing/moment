import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import request from 'supertest';
import {
  SEARCH_RATE_LIMIT,
  SEARCH_RATE_WINDOW_MS,
  searchKeyGenerator,
} from '../../src/middlewares/rate-limit.js';
import { listenLocalReady } from '../helpers/http-server.js';

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

describe('searchRateLimiter 契约（spec §6.2）', () => {
  it('生产常量 60s / 20', () => {
    expect(SEARCH_RATE_WINDOW_MS).toBe(60_000);
    expect(SEARCH_RATE_LIMIT).toBe(20);
  });

  it('searchKeyGenerator：同 /56 IPv6 + 同 userId → 同 key', () => {
    const ipA = '0123:4567:89ab:cd11:1111:1111:1111:1111';
    const ipB = '0123:4567:89ab:cd22:2222:2222:2222:2222';
    expect(ipKeyGenerator(ipA, 56)).toBe(ipKeyGenerator(ipB, 56));
    const k1 = searchKeyGenerator({ ip: ipA, user: { id: 'u-1' } } as never);
    const k2 = searchKeyGenerator({ ip: ipB, user: { id: 'u-1' } } as never);
    expect(k1).toBe(k2);
    expect(searchKeyGenerator({ ip: ipA, user: { id: 'u-2' } } as never)).not.toBe(k1);
  });

  it('同一 message 信封 429 RATE_LIMITED（独立小 app，不打满测试环境 1000）', async () => {
    const message = { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } };
    const app = express();
    app.use(express.json());
    app.post(
      '/api/search',
      rateLimit({
        windowMs: 60_000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: searchKeyGenerator,
        message,
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const server = await listenLocalReady(app);
    expect((await request(server).post('/api/search').send({})).status).toBe(200);
    expect((await request(server).post('/api/search').send({})).status).toBe(200);
    const limited = await request(server).post('/api/search').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('app.ts 在 populateUser 之后挂 POST /api/search limiter，并注册 SearchController', () => {
    const src = readFileSync(path.join(SERVER_SRC, 'app.ts'), 'utf8');
    const pop = src.indexOf('app.use(populateUser)');
    const lim = src.indexOf("app.post('/api/search', searchRateLimiter)");
    const useExpress = src.indexOf('useExpressServer(app');
    expect(pop).toBeGreaterThan(-1);
    expect(lim).toBeGreaterThan(pop);
    expect(useExpress).toBeGreaterThan(lim);
    expect(src).toContain('SearchController');
    expect(src).toContain('InternalEmbeddingsController');
  });
});
