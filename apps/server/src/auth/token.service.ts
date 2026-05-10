import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { refreshTokens } from '../db/schema.js';

const ACCESS_TYPE = 'access';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Service()
export class TokenService {
  signAccessToken(userId: string): string {
    return jwt.sign({ sub: userId, type: ACCESS_TYPE }, config.JWT_SECRET, {
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  verifyAccessToken(token: string): { userId: string; iat: number } {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
      if (payload.type !== ACCESS_TYPE || typeof payload.sub !== 'string' || !payload.iat) {
        throw new Error('bad payload');
      }
      return { userId: payload.sub, iat: payload.iat };
    } catch {
      throw new UnauthorizedError('INVALID_TOKEN');
    }
  }

  /** 返回原始 refresh token（只给客户端这一次，库里只存 sha256）。 */
  async issueRefreshToken(userId: string, deviceInfo?: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await db.insert(refreshTokens).values({
      userId,
      tokenHash: sha256(raw),
      deviceInfo: deviceInfo ?? null,
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });
    return raw;
  }

  /**
   * 旋转 refresh token：旧 token 立即吊销并签发新 token。
   * 已吊销 token 被重放 = 泄露信号 → 吊销该用户全部 refresh token。
   */
  async rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string }> {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(raw)))
      .limit(1);

    if (!row) throw new UnauthorizedError('INVALID_REFRESH_TOKEN');
    if (row.revokedAt) {
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedError('REFRESH_TOKEN_REUSED');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('REFRESH_TOKEN_EXPIRED');
    }

    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    const refreshToken = await this.issueRefreshToken(row.userId, row.deviceInfo ?? undefined);
    return { userId: row.userId, refreshToken };
  }

  /** 幂等：未知 token 直接返回。 */
  async revokeRefreshToken(raw: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, sha256(raw)), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
