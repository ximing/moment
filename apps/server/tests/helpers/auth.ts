import type { AuthResponse } from '@moment/dto';
import type { Express } from 'express';
import request from 'supertest';

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

/** 走真实注册接口造用户（密码统一 secret123），返回 id/email/accessToken。 */
export async function createUser(app: Express, email: string, nickname?: string): Promise<TestUser> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', nickname: nickname ?? email.split('@')[0] });
  if (res.status !== 201) {
    throw new Error(`createUser(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as AuthResponse;
  return { id: body.user.id, email: body.user.email, accessToken: body.tokens.accessToken };
}

/** Authorization 头值。 */
export function auth(user: TestUser): string {
  return `Bearer ${user.accessToken}`;
}
