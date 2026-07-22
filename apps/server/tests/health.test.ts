import request from 'supertest';
import { createApp } from '../src/app.js';
import { listenLocalReady } from './helpers/http-server.js';

describe('GET /api/health', () => {
  it('返回 200 {status:"ok"}', async () => {
    const app = await listenLocalReady(createApp());
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('未知路由返回统一错误结构', async () => {
    const app = await listenLocalReady(createApp());
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error.code).toBe('string');
  });
});
