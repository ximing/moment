import type { ChainDto, ChainRole } from '@moment/dto';
import type { Express } from 'express';
import request from 'supertest';
import { db } from '../../src/db/index.js';
import { chainMembers } from '../../src/db/schema.js';
import { auth, type TestUser } from './auth.js';

/** 走真实 API 建链，返回 ChainDto。 */
export async function createChain(app: Express, owner: TestUser, name = '测试链'): Promise<ChainDto> {
  const res = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name });
  if (res.status !== 201) {
    throw new Error(`createChain failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as ChainDto;
}

/** 直接入库加成员（绕过邀请流程，供权限矩阵类测试准备数据）。 */
export async function addMember(chainId: string, userId: string, role: ChainRole): Promise<void> {
  await db.insert(chainMembers).values({ chainId, userId, role });
}
