import type { ChainDto, ChainRole } from '@moment/dto';
import type { Server } from 'node:http';
import type { Express } from 'express';
import request from 'supertest';
import { db } from '../../src/db/index.js';
import { chainMembers } from '../../src/db/schema.js';
import { auth, type TestUser } from './auth.js';

/** 走真实 API 建链，返回 ChainDto。template 默认 daily（spec §2.3：存量与测试默认模板）。 */
export async function createChain(
  app: Express | Server,
  owner: TestUser,
  name = '测试链',
  template = 'daily',
): Promise<ChainDto> {
  const res = await request(app).post('/api/chains').set('Authorization', auth(owner)).send({ name, template });
  if (res.status !== 201) {
    throw new Error(`createChain failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as ChainDto;
}

/** 直接入库加成员（绕过邀请流程，供权限矩阵类测试准备数据）。 */
export async function addMember(chainId: string, userId: string, role: ChainRole): Promise<void> {
  await db.insert(chainMembers).values({ chainId, userId, role });
}
