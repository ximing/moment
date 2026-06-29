import { randomUUID } from 'node:crypto';
import mime from 'mime-types';
import {
  CHAIN_COLORS,
  CHAIN_ICONS,
  IMAGE_MIME_TYPES,
  type AuthResponse,
  type ChainColor,
  type ChainIcon,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type UpdateMeInput,
  type UserProfile,
} from '@moment/dto';
import { eq } from 'drizzle-orm';
import { BadRequestError, HttpError, NotFoundError, UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { media, users, type User } from '../db/schema.js';
import { getStorage } from '../storage/factory.js';
import { logger } from '../utils/logger.js';
import { avatarExpiresAt, signAvatarGetUrl } from './avatar.js';
import { hashPassword, verifyPassword } from './password.js';
import { TokenService } from './token.service.js';

function isChainColor(v: string | null): v is ChainColor {
  return v !== null && (CHAIN_COLORS as readonly string[]).includes(v);
}

function isChainIcon(v: string | null): v is ChainIcon {
  return v !== null && (CHAIN_ICONS as readonly string[]).includes(v);
}

@Service()
export class AuthService {
  constructor(private tokens: TokenService) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED');

    const user: User = {
      id: randomUUID(),
      email: input.email,
      passwordHash: await hashPassword(input.password),
      nickname: input.nickname,
      passwordChangedAt: null,
      avatarMediaId: null,
      avatarColor: null,
      avatarIcon: null,
      createdAt: new Date(),
    };
    await db.insert(users).values(user);
    return this.buildAuthResponse(user);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedError('INVALID_CREDENTIALS');
    }
    return this.buildAuthResponse(user);
  }

  async refresh(raw: string): Promise<AuthResponse> {
    const { userId, refreshToken } = await this.tokens.rotateRefreshToken(raw);
    const user = await this.getUserEntity(userId);
    return {
      user: await this.toProfile(user),
      tokens: {
        accessToken: this.tokens.signAccessToken(user.id),
        refreshToken,
        expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }

  async logout(raw: string): Promise<void> {
    await this.tokens.revokeRefreshToken(raw);
  }

  /**
   * 修改密码：校验旧密码 → 更新哈希 + passwordChangedAt（旧 access token 即刻失效，
   * 见 authorization.ts）→ 吊销全部 refresh token。改密即全端下线（含当前会话），客户端需重新登录。
   * 旧密码错误返回 400 而非 401：401 会触发 api-client 的 refresh+重放，误清登录态。
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.getUserEntity(userId);
    if (!(await verifyPassword(input.oldPassword, user.passwordHash))) {
      throw new BadRequestError('INVALID_OLD_PASSWORD');
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() })
      .where(eq(users.id, user.id));
    await this.tokens.revokeAllForUser(userId);
  }

  async getUserEntity(userId: string): Promise<User> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError('USER_NOT_FOUND');
    return user;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    return this.toProfile(await this.getUserEntity(userId));
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<UserProfile> {
    const user = await this.getUserEntity(userId);
    if (input.avatarMediaId !== undefined) {
      await this.bindAvatar(user, input.avatarMediaId);
    }
    const patch = {
      ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
      ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
      ...(input.avatarIcon !== undefined ? { avatarIcon: input.avatarIcon } : {}),
    };
    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, user.id));
    }
    return this.toProfile(await this.getUserEntity(userId));
  }

  /** 请求上下文用：不签发 S3 链接。 */
  toAuthPrincipal(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatarColor: isChainColor(user.avatarColor) ? user.avatarColor : null,
      avatarIcon: isChainIcon(user.avatarIcon) ? user.avatarIcon : null,
      avatarUrl: null,
      avatarExpiresAt: null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** API 下发：每次重新签发 6 天头像链接。 */
  async toProfile(user: User): Promise<UserProfile> {
    const base = this.toAuthPrincipal(user);
    if (!user.avatarMediaId) return base;
    const [row] = await db.select().from(media).where(eq(media.id, user.avatarMediaId)).limit(1);
    if (!row || row.status !== 'ready') return base;
    const url = await signAvatarGetUrl(row.s3Key, row.storageMeta);
    return { ...base, avatarUrl: url, avatarExpiresAt: avatarExpiresAt().toISOString() };
  }

  private async bindAvatar(user: User, avatarMediaId: string | null): Promise<void> {
    if (avatarMediaId === null) {
      await db.update(users).set({ avatarMediaId: null }).where(eq(users.id, user.id));
      return;
    }
    const [row] = await db.select().from(media).where(eq(media.id, avatarMediaId)).limit(1);
    if (!row || row.uploaderId !== user.id || row.status !== 'ready') {
      throw new NotFoundError('MEDIA_NOT_FOUND');
    }
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(row.mime)) {
      throw new BadRequestError('MEDIA_INVALID');
    }
    if (row.momentId) throw new BadRequestError('MEDIA_ALREADY_BOUND');

    const ext = mime.extension(row.mime) || 'bin';
    const finalKey = `users/${user.id}/avatar/${row.id}.${ext}`;
    if (row.s3Key !== finalKey) {
      await getStorage().copyObject(row.s3Key, finalKey, row.storageMeta);
      await db.update(media).set({ s3Key: finalKey }).where(eq(media.id, row.id));
      await getStorage()
        .deleteFile(row.s3Key, row.storageMeta)
        .catch((err: unknown) => {
          logger.warn(`avatar tmp cleanup failed: ${row.s3Key}`, err);
        });
    }

    const prev = user.avatarMediaId;
    await db.update(users).set({ avatarMediaId: row.id }).where(eq(users.id, user.id));
    if (prev && prev !== row.id) {
      await db.update(media).set({ status: 'orphaned' }).where(eq(media.id, prev));
    }
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    return {
      user: await this.toProfile(user),
      tokens: {
        accessToken: this.tokens.signAccessToken(user.id),
        refreshToken: await this.tokens.issueRefreshToken(user.id),
        expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }
}
