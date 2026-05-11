import type { UserProfile } from '@moment/dto';
import type { Action } from 'routing-controllers';
import { Container } from 'typedi';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

/**
 * routing-controllers 鉴权钩子：校验 Bearer access token，
 * 并拒绝签发时间早于 passwordChangedAt 的旧 token（改密即全端下线）。
 */
export async function authorizationChecker(action: Action, _roles: string[]): Promise<boolean> {
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
