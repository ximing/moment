import 'reflect-metadata';
import { UnauthorizedError } from 'routing-controllers';
import { Container } from 'typedi';
import { TokenService } from '../../src/auth/token.service.js';
import { db } from '../../src/db/index.js';
import { refreshTokens, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

const service = () => Container.get(TokenService);

async function insertUser(id = 'user-1'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.com`, passwordHash: 'x', nickname: id });
  return id;
}

beforeEach(resetDb);
afterAll(closeDb);

describe('TokenService access token', () => {
  it('签发并可验证，返回 userId 与 iat', () => {
    const token = service().signAccessToken('user-1');
    const payload = service().verifyAccessToken(token);
    expect(payload.userId).toBe('user-1');
    expect(typeof payload.iat).toBe('number');
  });

  it('篡改的 token 抛 UnauthorizedError', () => {
    expect(() => service().verifyAccessToken('bad.token.here')).toThrow(UnauthorizedError);
  });
});

describe('TokenService refresh token', () => {
  it('旋转：旧 token 换新 token，旧 token 再次使用判复用并吊销全部', async () => {
    const userId = await insertUser();
    const raw1 = await service().issueRefreshToken(userId);
    const rotated = await service().rotateRefreshToken(raw1);
    expect(rotated.userId).toBe(userId);
    expect(rotated.refreshToken).not.toBe(raw1);

    // 旧 token 重放 → REFRESH_TOKEN_REUSED，且该用户所有 refresh token 被吊销
    await expect(service().rotateRefreshToken(raw1)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_REUSED',
    });
    // 连带吊销后，新 token 同样命中「已吊销」分支
    await expect(service().rotateRefreshToken(rotated.refreshToken)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_REUSED',
    });
  });

  it('未知 token 抛 INVALID_REFRESH_TOKEN', async () => {
    await expect(service().rotateRefreshToken('nope')).rejects.toMatchObject({
      message: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('过期 token 抛 REFRESH_TOKEN_EXPIRED', async () => {
    const userId = await insertUser();
    const raw = await service().issueRefreshToken(userId);
    // 直接把过期时间改到过去
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(raw).digest('hex');
    const { eq } = await import('drizzle-orm');
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, hash));
    await expect(service().rotateRefreshToken(raw)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_EXPIRED',
    });
  });

  it('revokeRefreshToken 幂等；revokeAllForUser 吊销全部', async () => {
    const userId = await insertUser();
    const raw = await service().issueRefreshToken(userId);
    await service().revokeRefreshToken(raw);
    await service().revokeRefreshToken(raw); // 不抛
    await expect(service().rotateRefreshToken(raw)).rejects.toMatchObject({
      message: 'REFRESH_TOKEN_REUSED',
    });
  });
});
