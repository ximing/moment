import type { UserProfile } from '@moment/dto';
import type { NextFunction, Request, Response } from 'express';
import type { Action } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

/**
 * routing-controllers 鉴权钩子：校验 Bearer access token，
 * 并拒绝签发时间早于 passwordChangedAt 的旧 token（改密即全端下线）。
 */
export async function authorizationChecker(action: Action, _roles: string[]): Promise<boolean> {
  // populateUser 已完成同样的校验（含 passwordChangedAt），直接采信，避免重复查库
  if ((action.request as unknown as { user?: UserProfile }).user) return true;
  const header: string | undefined = action.request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    const { userId, iat } = Container.get(TokenService).verifyAccessToken(header.slice(7));
    const auth = Container.get(AuthService);
    const user = await auth.getUserEntity(userId);
    if (user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000) return false;
    (action.request as unknown as { user: UserProfile }).user = auth.toProfile(user);
    return true;
  } catch {
    return false;
  }
}

export async function currentUserChecker(action: Action): Promise<UserProfile | null> {
  return (action.request as unknown as { user?: UserProfile }).user ?? null;
}

/**
 * 全局前置中间件：请求带有效 Bearer token 时填充 request.user；无效/缺失 token 不拒绝
 * （保持匿名，由受保护路由上的 @Authorized 统一 401）。
 * 必须在 useExpressServer 之前挂载——routing-controllers 0.11 中 @UseBefore 中间件
 * （如 requireChainRole）先于 @Authorized 的 authorizationChecker 执行，依赖 request.user 已就绪。
 */
export async function populateUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const { userId, iat } = Container.get(TokenService).verifyAccessToken(header.slice(7));
      const auth = Container.get(AuthService);
      const user = await auth.getUserEntity(userId);
      if (!(user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000)) {
        (req as unknown as { user: UserProfile }).user = auth.toProfile(user);
      }
    } catch {
      // 缺失/无效 token：保持匿名
    }
  }
  next();
}
