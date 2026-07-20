import 'reflect-metadata';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { useContainer, useExpressServer } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthController } from './auth/auth.controller.js';
import { authorizationChecker, currentUserChecker, populateUser } from './auth/authorization.js';
import { ChainsController } from './chains/chains.controller.js';
import { InvitesController } from './chains/invites.controller.js';
import { CommentsController } from './comments/comments.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { ReactionsController } from './reactions/reactions.controller.js';
import { MediaController } from './media/media.controller.js';
import { ErrorHandlerMiddleware } from './middlewares/error-handler.js';
import { MomentController, MomentItemController } from './moments/moment.controller.js';
import { authRateLimiter, inviteAcceptRateLimiter, loginRateLimiter, publicShareRateLimiter } from './middlewares/rate-limit.js';
import { TagController } from './tags/tag.controller.js';
import { FeedController } from './feed/feed.controller.js';
import { MemoriesController } from './memories/memories.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { DevicesController } from './devices/devices.controller.js';
import { PublicShareController } from './share/public-share.controller.js';
import { ShareLinkItemController, ShareLinksController } from './share/share-links.controller.js';
import { RecapController } from './recaps/recap.controller.js';
import { TemplatesController } from './templates/template.controller.js';
import { AggregateController } from './templates/aggregate.controller.js';

export function createApp(): express.Express {
  useContainer(Container);
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth/login', loginRateLimiter);
  app.use('/api/auth/register', authRateLimiter);
  // 改密校验旧密码，同 register 档限流防在线爆破
  app.use('/api/auth/change-password', authRateLimiter);
  app.use('/api/public', publicShareRateLimiter);

  // 在 routing-controllers 路由前解析 Bearer token 并填充 request.user：
  // @UseBefore 中间件（requireChainRole 等）先于 @Authorized 的 authorizationChecker 执行，
  // 角色中间件依赖 request.user，必须提前挂载。
  app.use(populateUser);

  // 邀请接受限流（spec §4/§6：IP + 账号维度）——挂在 populateUser 之后，keyGenerator 可读 req.user。
  // 命中后 next() 落入 routing-controllers 的同名 POST 路由，不影响其注册。
  app.post('/api/invites/:token/accept', inviteAcceptRateLimiter);

  useExpressServer(app, {
    routePrefix: '/api',
    controllers: [HealthController, AuthController, ChainsController, InvitesController, MediaController, MomentController, MomentItemController, TagController, FeedController, MemoriesController, CommentsController, ReactionsController, NotificationsController, DevicesController, ShareLinksController, ShareLinkItemController, PublicShareController, TemplatesController, AggregateController, RecapController],
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
