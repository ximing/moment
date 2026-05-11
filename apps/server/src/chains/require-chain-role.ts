import type { UserProfile } from '@moment/dto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { BadRequestError, UnauthorizedError } from 'routing-controllers';
import { Container } from 'typedi';
import { ChainPolicy, type ChainRole } from './chain-policy.js';

/**
 * 中间件工厂：@UseBefore(requireChainRole('editor'))。
 * chainId 取自 params.chainId；角色挂 request.chainRole。
 * 依赖 request.user——由全局 populateUser 中间件在 useExpressServer 之前填充
 * （@UseBefore 先于 @Authorized 的 authorizationChecker 执行，见 app.ts 注释）。
 */
export function requireChainRole(minRole: ChainRole): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = (req as unknown as { user?: UserProfile }).user;
      if (!user) throw new UnauthorizedError('UNAUTHORIZED');
      const chainId = req.params.chainId;
      if (!chainId) throw new BadRequestError('CHAIN_ID_REQUIRED');
      const role = await Container.get(ChainPolicy).require(user.id, chainId, minRole);
      (req as unknown as { chainRole: ChainRole }).chainRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}
