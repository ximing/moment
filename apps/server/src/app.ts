import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthController } from './auth/auth.controller.js';
import { authorizationChecker, currentUserChecker } from './auth/authorization.js';
import { HealthController } from './controllers/health.controller.js';
import { ErrorHandlerMiddleware } from './middlewares/error-handler.js';
import { authRateLimiter, loginRateLimiter } from './middlewares/rate-limit.js';

export function createApp(): express.Express {
  useContainer(Container);
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api/auth/register', authRateLimiter);

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController, AuthController],
    middlewares: [ErrorHandlerMiddleware],
    defaultErrorHandler: false,
    authorizationChecker,
    currentUserChecker,
  });

  // 统一 404（useExpressServer 之后注册，兜底未匹配路由）——Task 3 已引入，替换时必须保留
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  return app;
}
