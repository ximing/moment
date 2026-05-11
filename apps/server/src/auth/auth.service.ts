import { randomUUID } from 'node:crypto';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@moment/dto';
import { eq } from 'drizzle-orm';
import { HttpError, NotFoundError, UnauthorizedError } from 'routing-controllers';
import { Service } from 'typedi';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users, type User } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';
import { TokenService } from './token.service.js';

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
      user: this.toProfile(user),
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

  async getUserEntity(userId: string): Promise<User> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError('USER_NOT_FOUND');
    return user;
  }

  toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    return {
      user: this.toProfile(user),
      tokens: {
        accessToken: this.tokens.signAccessToken(user.id),
        refreshToken: await this.tokens.issueRefreshToken(user.id),
        expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  }
}
