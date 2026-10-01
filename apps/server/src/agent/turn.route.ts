import { postAgentTurnInputSchema, type UserProfile } from '@moment/dto';
import type { Express, NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from 'routing-controllers';
import { Container } from 'typedi';
import { agentTurnRateLimiter } from '../middlewares/rate-limit.js';
import { AgentService } from './agent.service.js';

/**
 * 发送不走 routing-controllers：它的成功处理会在写出响应后再 next()，SSE 容易被包成 JSON。
 * 挂在 populateUser 之后、useExpressServer 之前。限流与处理函数在同一次 app.post 上。
 */
export function registerAgentTurnRoute(app: Express): void {
  app.post('/api/agent/threads/:id/turns', agentTurnRateLimiter, (req, res, next) => {
    handleAgentTurn(req, res, next).catch(next);
  });
}

async function handleAgentTurn(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as Request & { user?: UserProfile }).user;
  if (!user) {
    next(new UnauthorizedError('UNAUTHORIZED'));
    return;
  }
  const parsed = postAgentTurnInputSchema.safeParse(req.body);
  if (!parsed.success) {
    next(parsed.error);
    return;
  }
  const threadId = typeof req.params.id === 'string' ? req.params.id : '';
  try {
    await Container.get(AgentService).streamTurn(user.id, threadId, parsed.data, res);
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    next(err);
  }
}
