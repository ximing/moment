import request from 'supertest';
import { jest } from '@jest/globals';
import { createApp, notFoundFallback } from '../src/app.js';
import { listenLocalReady } from './helpers/http-server.js';
import type { Response, NextFunction } from 'express';

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

describe('notFoundFallback', () => {
  // 回归：routing-controllers 的 handleSuccess 在成功发送响应后会调 next()，
  // 请求落进 /api 404 兜底。此时 res 已发送，兜底若再 res.status().json() 会抛
  // ERR_HTTP_HEADERS_SENT 噪音（健康检查等高频端点放大）。已发送响应必须直接放行。
  it('res 已发送（headersSent）→ 调 next，不重复发送', () => {
    const res = { headersSent: true, status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    notFoundFallback({} as never, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('res 未发送（未匹配路由）→ 发 404 统一错误结构', () => {
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction;
    notFoundFallback({} as never, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
});
