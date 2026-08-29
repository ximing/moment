import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import {
  OUTBOX_MOMENT_COMPRESS,
  OUTBOX_MOMENT_CREATED,
  OUTBOX_MOMENT_EMBED,
  OUTBOX_MOMENT_EXTRACT,
  OUTBOX_RECAP_GENERATE,
} from '../../src/outbox/types.js';
import { logger } from '../../src/utils/logger.js';
import { closeDb, resetDb } from '../helpers/db.js';

const SERVICE_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/jobs/jobs.service.ts');
const CHAIN_A = '11111111-1111-4111-8111-111111111111';
const CHAIN_B = '22222222-2222-4222-8222-222222222222';
const MOMENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MOMENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEDIA_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(resetDb);
afterAll(closeDb);

async function insertJob(over: {
  id?: string;
  type: string;
  status?: 'pending' | 'done' | 'failed';
  payload: object;
  createdAt: Date;
  processedAt?: Date | null;
  attempts?: number;
  lastError?: string | null;
}): Promise<string> {
  const id = over.id ?? randomUUID();
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

describe('JobsService.list（spec §6.4）', () => {
  it('不在 SQL 用 JSON 函数滤 payload.chainId；无 SQL LIMIT；不调 ChainPolicy', () => {
    const src = readFileSync(SERVICE_SRC, 'utf8');
    expect(src.toLowerCase()).not.toMatch(/json_|payload->>|payload->|\.limit\s*\(/);
    expect(src).not.toMatch(/sql\s*\x60/);
    expect(src).not.toMatch(/ChainPolicy|CHAIN_ROLE_INSUFFICIENT|requireChainRole/);
  });

  it('只投影 compress/embed；extract/created/recap 同链也不出现；默认不返回 done', async () => {
    await insertJob({
      type: OUTBOX_MOMENT_EXTRACT,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(9),
    });
    await insertJob({
      type: OUTBOX_MOMENT_CREATED,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(10),
    });
    await insertJob({
      type: OUTBOX_RECAP_GENERATE,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, period: '2026-08' },
      createdAt: t(11),
    });
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(8),
      processedAt: t(8),
    });
    const pendingId = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(7),
    });
    const failedId = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'failed',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(6),
      attempts: 1,
      lastError: 'dim mismatch',
      processedAt: t(6),
    });

    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
    expect(res.jobs.map((j) => j.id)).toEqual([pendingId, failedId]);
    expect(res.jobs.every((j) => j.type === 'moment.compress' || j.type === 'moment.embed')).toBe(true);
  });

  it('应用层滤 payload.chainId：他链更新的 2 条 + 本链更早 1 条，limit=2 仍返回本链', async () => {
    await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_B, chainId: CHAIN_B, mediaId: MEDIA_A },
      createdAt: t(20),
    });
    await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_B, chainId: CHAIN_B },
      createdAt: t(19),
    });
    const own = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(1),
    });

    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 2 });
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0].id).toBe(own);
    expect(res.jobs[0].momentId).toBe(MOMENT_A);
  });

  it('ORDER BY created_at DESC；lastError 映射；embed mediaId 恒 null', async () => {
    const older = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      status: 'failed',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(1),
      attempts: 1,
      lastError: 'OBJECT_TOO_LARGE',
      processedAt: t(2),
    });
    const newer = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(3),
    });

    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
    expect(res.jobs.map((j) => j.id)).toEqual([newer, older]);
    expect(res.jobs[0]).toMatchObject({
      type: 'moment.embed',
      status: 'pending',
      momentId: MOMENT_A,
      mediaId: null,
      attempts: 0,
      lastError: null,
      processedAt: null,
    });
    expect(res.jobs[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.jobs[1]).toMatchObject({
      type: 'moment.compress',
      status: 'failed',
      mediaId: MEDIA_A,
      attempts: 1,
      lastError: 'OBJECT_TOO_LARGE',
    });
    expect(res.jobs[1].processedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(res.jobs[0].createdAt)).toBeGreaterThan(Date.parse(res.jobs[1].createdAt));
  });

  it('缺 payload.momentId 的脏行跳过并 warn；合法行仍返回', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const dirtyId = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(5),
      });
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: '', chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(4),
      });
      const ok = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(3),
      });
      const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
      expect(res.jobs.map((j) => j.id)).toEqual([ok]);
      expect(warn).toHaveBeenCalledWith(
        'jobs: skip outbox row missing payload.momentId',
        expect.objectContaining({ id: dirtyId, type: OUTBOX_MOMENT_COMPRESS }),
      );
      expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('缺 payload.chainId 或 chainId 不符：静默丢弃且不 warn', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, mediaId: MEDIA_A },
        createdAt: t(5),
      });
      await insertJob({
        type: OUTBOX_MOMENT_EMBED,
        payload: { momentId: MOMENT_A, chainId: CHAIN_B },
        createdAt: t(4),
      });
      const ok = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(3),
      });
      const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
      expect(res.jobs.map((j) => j.id)).toEqual([ok]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('脏行不计入 limit：最新 2 条缺 momentId + 更早 1 条合法，limit=2 仍返回合法行', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(9),
      });
      await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(8),
      });
      const ok = await insertJob({
        type: OUTBOX_MOMENT_COMPRESS,
        payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
        createdAt: t(1),
      });
      const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 2 });
      expect(res.jobs.map((j) => j.id)).toEqual([ok]);
    } finally {
      warn.mockRestore();
    }
  });

  it('compress 缺/空 mediaId 仍返回且 mediaId=null', async () => {
    const missing = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(2),
    });
    const empty = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: '' },
      createdAt: t(1),
    });
    const res = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 50 });
    expect(res.jobs.map((j) => j.id)).toEqual([missing, empty]);
    expect(res.jobs[0].mediaId).toBeNull();
    expect(res.jobs[1].mediaId).toBeNull();
  });

  it('status=done 才返回 done；limit 截断为最新 N 条（本链 3 条 limit=2）', async () => {
    const a = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      status: 'done',
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(1),
      processedAt: t(1),
    });
    const b = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(2),
    });
    const c = await insertJob({
      type: OUTBOX_MOMENT_COMPRESS,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A, mediaId: MEDIA_A },
      createdAt: t(3),
    });
    const d = await insertJob({
      type: OUTBOX_MOMENT_EMBED,
      payload: { momentId: MOMENT_A, chainId: CHAIN_A },
      createdAt: t(4),
    });

    const doneOnly = await new JobsService().list(CHAIN_A, { status: ['done'], limit: 50 });
    expect(doneOnly.jobs.map((j) => j.id)).toEqual([a]);

    const top = await new JobsService().list(CHAIN_A, { status: ['pending', 'failed'], limit: 2 });
    expect(top.jobs.map((j) => j.id)).toEqual([d, c]);
    expect(top.jobs.map((j) => j.id)).not.toContain(b);
  });
});
