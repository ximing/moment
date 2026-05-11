import 'reflect-metadata';
import { Container } from 'typedi';
import { ChainPolicy, type ChainRole } from '../../src/chains/chain-policy.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, users } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';

const policy = () => Container.get(ChainPolicy);

beforeEach(async () => {
  await resetDb();
  await db.insert(users).values([
    { id: 'user-owner', email: 'o@t.com', passwordHash: 'x', nickname: 'o' },
    { id: 'user-editor', email: 'e@t.com', passwordHash: 'x', nickname: 'e' },
    { id: 'user-viewer', email: 'v@t.com', passwordHash: 'x', nickname: 'v' },
    { id: 'user-stranger', email: 's@t.com', passwordHash: 'x', nickname: 's' },
  ]);
  await db.insert(chains).values({ id: 'chain-1', name: 'c', ownerId: 'user-owner' });
  await db.insert(chainMembers).values([
    { chainId: 'chain-1', userId: 'user-owner', role: 'owner' },
    { chainId: 'chain-1', userId: 'user-editor', role: 'editor' },
    { chainId: 'chain-1', userId: 'user-viewer', role: 'viewer' },
  ]);
});
afterAll(closeDb);

describe('ChainPolicy.require 角色矩阵（3 角色 × 3 最低要求）', () => {
  const ORDER: ChainRole[] = ['viewer', 'editor', 'owner'];
  const usersByRole: Record<ChainRole, string> = {
    viewer: 'user-viewer',
    editor: 'user-editor',
    owner: 'user-owner',
  };
  const cases = ORDER.flatMap((actual) => ORDER.map((min) => [actual, min] as [ChainRole, ChainRole]));

  it.each(cases)('实际角色 %s / 要求 %s', async (actual, min) => {
    const allowed = ORDER.indexOf(actual) >= ORDER.indexOf(min);
    const run = () => policy().require(usersByRole[actual], 'chain-1', min);
    if (allowed) {
      await expect(run()).resolves.toBe(actual);
    } else {
      await expect(run()).rejects.toMatchObject({ httpCode: 403, message: 'CHAIN_ROLE_INSUFFICIENT' });
    }
  });

  it('非成员 → 404 CHAIN_NOT_FOUND（不泄露链存在性）', async () => {
    await expect(policy().require('user-stranger', 'chain-1', 'viewer')).rejects.toMatchObject({
      httpCode: 404,
      message: 'CHAIN_NOT_FOUND',
    });
  });

  it('链不存在 → 404 CHAIN_NOT_FOUND', async () => {
    await expect(policy().require('user-owner', 'no-such-chain', 'viewer')).rejects.toMatchObject({
      httpCode: 404,
      message: 'CHAIN_NOT_FOUND',
    });
  });
});
