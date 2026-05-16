import { randomUUID } from 'node:crypto';
import type { AuthResponse } from '@moment/dto';
import type { Express } from 'express';
import request from 'supertest';

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  /** alias of accessToken — Phase 3 tests use alice.token */
  token: string;
}

/**
 * Dual-signature:
 * - createUser(app, 'owner@example.com') → email as given (Phase 2)
 * - createUser(app, 'alice') → generate email, nickname=alice (Phase 3)
 */
export async function createUser(app: Express, emailOrName: string, nickname?: string): Promise<TestUser> {
  const looksLikeEmail = emailOrName.includes('@');
  const email = looksLikeEmail
    ? emailOrName
    : `${emailOrName.toLowerCase()}-${randomUUID().slice(0, 8)}@test.com`;
  const nick = nickname ?? (looksLikeEmail ? email.split('@')[0] : emailOrName);
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', nickname: nick });
  if (res.status !== 201) {
    throw new Error(`createUser(${emailOrName}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as AuthResponse;
  const accessToken = body.tokens.accessToken;
  return { id: body.user.id, email: body.user.email, accessToken, token: accessToken };
}

export function auth(user: TestUser): string {
  return `Bearer ${user.accessToken}`;
}
