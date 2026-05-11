import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthController } from './auth/auth.controller.js';
import { authorizationChecker, currentUserChecker, populateUser } from './auth/authorization.js';
import { ChainsController } from './chains/chains.controller.js';
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

  // 在 routing-controllers 路由前解析 Bearer token 并填充 request.user：
  // @UseBefore 中间件（requireChainRole 等）先于 @Authorized 的 authorizationChecker 执行，
  // 角色中间件依赖 request.user，必须提前挂载。
  app.use(populateUser);

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController, AuthController, ChainsController],
    middlewares: [ErrorHandlerMiddleware],
    defaultErrorHandler: false,
    authorizationChecker,
    currentUserChecker,
  });

  // 统一 404（useExpressServer 之后注册，兜底未匹配路由）
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });
  return app;
}
