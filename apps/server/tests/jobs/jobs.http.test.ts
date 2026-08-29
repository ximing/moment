import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import {
  OUTBOX_MOMENT_COMPRESS,
  OUTBOX_MOMENT_EMBED,
  OUTBOX_MOMENT_EXTRACT,
} from '../../src/outbox/types.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, registerUser } from '../helpers/fixtures.js';

const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const MOMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEDIA_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(resetDb);
afterAll(closeDb);

async function insertJob(over: {
  type: string;
  status?: 'pending' | 'done' | 'failed';
  payload: object;
  createdAt: Date;
  processedAt?: Date | null;
  attempts?: number;
  lastError?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(outbox).values({
    id,
    type: over.type,
    payload: over.payload,
    status: over.status ?? 'pending',
    attempts: over.attempts ?? 0,
    createdAt: over.createdAt,
    processedAt: over.processedAt ?? null,
    lastError: over.lastError ?? null,
  });
  return id;
}

const t = (sec: number) => new Date(Date.UTC(2026, 7, 29, 12, 0, sec));

describe('GET /api/chains/:chainId/jobs（spec §6.4 / §9）', () => {
  it('app.ts 注册 JobsController；controller 用 requireChainRole(owner)，不手写角色码', () => {
    const appSrc = readFileSync(path.join(SERVER_SRC, 'app.ts'), 'utf8');
    expect(appSrc).toContain('JobsController');
    expect(appSrc).toContain('RecapController');
    expect(appSrc).toContain('ShareLinksController');
    const ctrl = readFileSync(path.join(SERVER_SRC, 'jobs/jobs.controller.ts'), 'utf8');
    expect(ctrl).toContain("@JsonController('/chains/:chainId/jobs')");
    expect(ctrl).toContain('@Authorized()');
    expect(ctrl).toContain("requireChainRole('owner')");
    expect(ctrl).not.toContain('CHAIN_ROLE_INSUFFICIENT');
    expect(ctrl).not.toContain('ChainPolicy');
  });

  it('owner 200：映射 lastError/mediaId；默认不含 done 与 extract；createdAt 倒序', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id, '宝宝成长');
    await insertJob({
      type: OUTBOX_MOMENT_EXTRACT,
      payload: { momentId: MOMENT_A, chainId },
      createdAt: t(9),
    });
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(8),
      processedAt: t(8),
    });
    const pendingId = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(7),
    });
    const failedId = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'failed',
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(6),
      attempts: 2,
      lastError: 'OBJECT_TOO_LARGE',
      processedAt: t(6),
    });

    const res = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['jobs']);
    expect(res.body.nextCursor).toBeUndefined();
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual([pendingId, failedId]);
    expect(res.body.jobs[0]).toMatchObject({
      type: 'moment.compress',
      status: 'pending',
      momentId: MOMENT_A,
      mediaId: MEDIA_A,
      lastError: null,
    });
    expect(res.body.jobs[1]).toMatchObject({
      type: 'moment.embed',
      status: 'failed',
      momentId: MOMENT_A,
      mediaId: null,
      attempts: 2,
      lastError: 'OBJECT_TOO_LARGE',
    });
  });

  it('应用层 payload.chainId：他链更新的任务不出现在本链 GET', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(other.id);
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: otherChain, mediaId: MEDIA_A },
      createdAt: t(9),
    });
    await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_A, chainId: otherChain },
      createdAt: t(8),
    });
    const own = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
      createdAt: t(1),
    });
    const res = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: { id: string }) => j.id)).toEqual([own]);
  });

  it('editor/viewer → 403 CHAIN_ROLE_INSUFFICIENT；非成员与不存在的链 → 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const viewer = await registerUser();
    const outsider = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, editor.id, 'editor');
    await addMember(chainId, viewer.id, 'viewer');

    const asEditor = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(asEditor.status).toBe(403);
    expect(asEditor.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const asViewer = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const asOutsider = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(asOutsider.status).toBe(404);
    expect(asOutsider.body.error.code).toBe('CHAIN_NOT_FOUND');

    const missing = await request(app)
      .get('/api/chains/99999999-9999-4999-8999-999999999999/jobs')
      .set('Authorization', `Bearer ${owner.token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CHAIN_NOT_FOUND');

    const anon = await request(app).get(`/api/chains/${chainId}/jobs`);
    expect(anon.status).toBe(401);
  });

  it('非法 status / limit=51 → 400 VALIDATION_ERROR；?cursor= strip 仍 200', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);

    const badStatus = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ status: 'pending,nope' })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('VALIDATION_ERROR');

    const badLimit = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ limit: 51 })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.code).toBe('VALIDATION_ERROR');

    const withCursor = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ cursor: 'abc', before: '2026-08-01T00:00:00.000Z' })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(withCursor.status).toBe(200);
    expect(withCursor.body).toEqual({ jobs: [] });
    expect(withCursor.body.nextCursor).toBeUndefined();
  });

  it('status=done 返回 done；默认不返回；v1 无重试端点', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const doneId = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId },
      createdAt: t(1),
      processedAt: t(1),
    });

    const def = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(def.status).toBe(200);
    expect(def.body.jobs).toEqual([]);

    const done = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .query({ status: 'done' })
      .set('Authorization', `Bearer ${owner.token}`);
    expect(done.status).toBe(200);
    expect(done.body.jobs).toHaveLength(1);
    expect(done.body.jobs[0].id).toBe(doneId);

    const retry = await request(app)
      .post(`/api/chains/${chainId}/jobs/${doneId}/retry`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(retry.status).toBe(404);
  });

  it('本链 51 条 pending：默认返回 50 条且是最新的；不含最早那条', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const ids: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      ids.push(
        await insertJob({
          type: OUTBOX_MOMENT_COMPRESS,
          payload: { momentId: MOMENT_A, chainId, mediaId: MEDIA_A },
          createdAt: t(i),
        }),
      );
    }
    const res = await request(app)
      .get(`/api/chains/${chainId}/jobs`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(50);
    expect(res.body.jobs[0].id).toBe(ids[50]);
    expect(res.body.jobs[49].id).toBe(ids[1]);
    expect(res.body.jobs.map((j: { id: string }) => j.id)).not.toContain(ids[0]);
  });
});
