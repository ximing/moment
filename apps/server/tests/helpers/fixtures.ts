import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainMembers, chains, momentTags, moments, recaps } from '../../src/db/schema.js';
import { wallDateOf } from '../../src/moments/wall-date.js';
import { listenLocal } from './http-server.js';

export const app = listenLocal(createApp());

let seq = 0;

/** 走真实 API 注册，拿到 userId 与可用 access token。 */
export async function registerUser(): Promise<{ id: string; token: string }> {
  const email = `u${++seq}-${Date.now()}-${randomUUID().slice(0, 8)}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'secret123', nickname: `user${seq}` });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id: res.body.user.id, token: res.body.tokens.accessToken };
}

/** 直插链 + owner 成员行（绕过邀请流程，测试只关心权限判定本身）。template 默认 daily（spec §2.3）。 */
export async function createChain(ownerId: string, name = '测试链', template = 'daily'): Promise<string> {
  const id = randomUUID();
  await db.insert(chains).values({ id, name, ownerId, visibility: 'private', template });
  await db.insert(chainMembers).values({ chainId: id, userId: ownerId, role: 'owner', joinedAt: new Date() });
  return id;
}

export async function addMember(
  chainId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<void> {
  await db.insert(chainMembers).values({ chainId, userId, role, joinedAt: new Date() });
}

/** 直插 moment（feed/标签测试需要精确控制 happenedAt/createdAt/deletedAt）。 */
export async function insertMoment(opts: {
  chainId: string;
  authorId: string;
  happenedAt: Date;
  happenedTzOffset?: number;
  createdAt?: Date;
  content?: string;
  isBackfill?: boolean;
  deletedAt?: Date;
  kind?: string;
  payload?: Record<string, unknown> | null;
}): Promise<string> {
  const id = randomUUID();
  const at = opts.createdAt ?? new Date();
  const tzOffset = opts.happenedTzOffset ?? 0;
  await db.insert(moments).values({
    id,
    chainId: opts.chainId,
    authorId: opts.authorId,
    type: 'text',
    content: opts.content ?? '内容',
    happenedAt: opts.happenedAt,
    happenedTzOffset: tzOffset,
    // 写路径第四处（spec memories-today §1 review I2）：夹具必须与 create/update 同一公式补 wall_date
    wallDate: wallDateOf(opts.happenedAt, tzOffset),
    isBackfill: opts.isBackfill ?? false,
    kind: opts.kind ?? 'standard',
    payload: opts.payload ?? null,
    createdAt: at,
    updatedAt: at,
    deletedAt: opts.deletedAt ?? null,
  });
  return id;
}

/** 直插 moment-tag 关联。 */
export async function attachTag(momentId: string, tagId: string): Promise<void> {
  await db.insert(momentTags).values({ momentId, tagId });
}

/** 直插 recap 行（测试用，绕过 generate 管线）。默认 status=generating，可覆盖全字段。 */
export async function insertRecap(opts: {
  chainId: string;
  period: string;
  status?: 'generating' | 'ready' | 'failed' | 'degraded';
  content?: string;
  highlights?: string[];
  model?: string | null;
  promptVersion?: number;
  tokenUsage?: { prompt: number; completion: number; total: number } | null;
  error?: string | null;
  generatedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(recaps).values({
    id,
    chainId: opts.chainId,
    period: opts.period,
    status: opts.status ?? 'generating',
    content: opts.content ?? '',
    highlights: opts.highlights ?? [],
    model: opts.model ?? null,
    promptVersion: opts.promptVersion ?? 1,
    tokenUsage: opts.tokenUsage ?? null,
    error: opts.error ?? null,
    generatedAt: opts.generatedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
