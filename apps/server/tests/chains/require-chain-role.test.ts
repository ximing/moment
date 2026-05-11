import 'reflect-metadata';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { populateUser } from '../../src/auth/authorization.js';
import { TokenService } from '../../src/auth/token.service.js';
import { requireChainRole } from '../../src/chains/require-chain-role.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

/** 最小 harness：populateUser + requireChainRole('editor') + 与 ErrorHandlerMiddleware 同语义的错误处理。 */
function harness(): express.Express {
  const app = express();
  app.use(populateUser);
  app.get('/x/:chainId', requireChainRole('editor'), (req, res) => {
    res.json({ chainRole: (req as unknown as { chainRole: string }).chainRole });
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { httpCode?: number; message?: string; name?: string };
    const status = e.httpCode ?? 500;
    const code = e.message && /^[A-Z0-9_]+$/.test(e.message) ? e.message : e.name;
    res.status(status).json({ error: { code, message: e.message } });
  });
  return app;
}

async function insertMember(id: string, role: 'owner' | 'editor' | 'viewer'): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@t.com`, passwordHash: 'x', nickname: id });
  await db.insert(chainMembers).values({ chainId: 'chain-1', userId: id, role });
  return Container.get(TokenService).signAccessToken(id);
}

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values({ id: 'u-owner', email: 'owner@t.com', passwordHash: 'x', nickname: 'o' });
  await db.insert(chains).values({ id: 'chain-1', name: 'c', ownerId: 'u-owner' });
});
afterAll(closeDb);

describe('requireChainRole 中间件', () => {
  it('editor 成员放行并把角色挂到 request.chainRole', async () => {
    const token = await insertMember('u-editor', 'editor');
    const res = await request(harness()).get('/x/chain-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.chainRole).toBe('editor');
  });

  it('viewer 成员 → 403 CHAIN_ROLE_INSUFFICIENT', async () => {
    const token = await insertMember('u-viewer', 'viewer');
    const res = await request(harness()).get('/x/chain-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');
  });

  it('非成员 → 404 CHAIN_NOT_FOUND', async () => {
    await db.insert(users).values({ id: 'u-stranger', email: 's@t.com', passwordHash: 'x', nickname: 's' });
    const token = Container.get(TokenService).signAccessToken('u-stranger');
    const res = await request(harness()).get('/x/chain-1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('链不存在 → 404 CHAIN_NOT_FOUND', async () => {
    const token = await insertMember('u-editor2', 'editor');
    const res = await request(harness()).get('/x/no-such-chain').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAIN_NOT_FOUND');
  });

  it('无 token → 401 UNAUTHORIZED', async () => {
    const res = await request(harness()).get('/x/chain-1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
