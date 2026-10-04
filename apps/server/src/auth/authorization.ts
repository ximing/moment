import type { UserProfile } from "@moment/dto";
import type { NextFunction, Request, Response } from "express";
import type { Action } from "routing-controllers";
import { Container } from "typedi";
import { AccessTokenService } from "./access-token.service.js";
import { isPersonalAccessToken } from "./access-token-logic.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";

type RequestWithUser = {
  user?: UserProfile;
  headers: { authorization?: string };
};

/**
 * Bearer 先认接口令牌（mmt_），再认会话 JWT。
 * 两类凭证都拒绝早于 passwordChangedAt 的旧凭证（改密即全端下线）。
 * 令牌哈希不存在时保持匿名，不把 mmt_ 送进 jwt.verify。
 */
async function principalFromBearer(raw: string): Promise<UserProfile | null> {
  const auth = Container.get(AuthService);
  try {
    if (isPersonalAccessToken(raw)) {
      const row = await Container.get(AccessTokenService).findByRawToken(raw);
      if (!row) return null;
      const user = await auth.getUserEntity(row.userId);
      if (
        user.passwordChangedAt &&
        user.passwordChangedAt.getTime() > row.createdAt.getTime()
      )
        return null;
      return auth.toAuthPrincipal(user);
    }
    const { userId, iat } = Container.get(TokenService).verifyAccessToken(raw);
    const user = await auth.getUserEntity(userId);
    if (user.passwordChangedAt && user.passwordChangedAt.getTime() > iat * 1000)
      return null;
    return auth.toAuthPrincipal(user);
  } catch {
    return null;
  }
}

function bearerFrom(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * routing-controllers 鉴权钩子：校验 Bearer（接口令牌或 access token）。
 */
export async function authorizationChecker(
  action: Action,
  _roles: string[],
): Promise<boolean> {
  const request = action.request as unknown as RequestWithUser;
  // populateUser 已完成同样的校验（含 passwordChangedAt），直接采信，避免重复查库
  if (request.user) return true;
  const token = bearerFrom(request.headers.authorization);
  if (!token) return false;
  const principal = await principalFromBearer(token);
  if (!principal) return false;
  request.user = principal;
  return true;
}

export async function currentUserChecker(
  action: Action,
): Promise<UserProfile | null> {
  return (action.request as unknown as { user?: UserProfile }).user ?? null;
}

/**
 * 全局前置中间件：请求带有效 Bearer token 时填充 request.user；无效/缺失 token 不拒绝
 * （保持匿名，由受保护路由上的 @Authorized 统一 401）。
 * 必须在 useExpressServer 之前挂载——routing-controllers 0.11 中 @UseBefore 中间件
 * （如 requireChainRole）先于 @Authorized 的 authorizationChecker 执行，依赖 request.user 已就绪。
 */
export async function populateUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerFrom(req.headers.authorization);
  if (token) {
    const principal = await principalFromBearer(token);
    if (principal) (req as unknown as { user: UserProfile }).user = principal;
  }
  next();
}
