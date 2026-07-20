import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox, recaps } from '../../src/db/schema.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { runRecapSweep } from '../../src/worker/recap-scheduler.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment } from '../helpers/fixtures.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
  // 注入非 null 占位 provider：sweep 只检查 getLLMProvider() !== null，不调 provider.chat，
  // 故占位即可让 6 个机制测试通过派发（空 key 测试在自身内部 setLLMProvider(undefined) 重置）。
  setLLMProvider({} as unknown as LLMProvider);
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

describe('runRecapSweep（spec §1）', () => {
  it('非 1 号 → 不派发（dispatched=0）', async () => {
    const chainId = await createChain(owner.id);
    // 上月（2026-06）有活动
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // now = 2026-07-15（非 1 号）
    const result = await runRecapSweep(new Date('2026-07-15T00:00:00Z'));
    expect(result.dispatched).toBe(0);
  });

  it('空 key（LLM 停用）→ 跳过派发 dispatched=0（spec §3：扫描照常但跳过派发）', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    setLLMProvider(undefined); // 重置 → getLLMProvider() 返回真实 config（测试库空 key → null）
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0);
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(0); // 不派发 outbox
  });

  it('每月 1 号 + 上月有活动 → 派发 recap.generate outbox（period=上月）', async () => {
    const chainId = await createChain(owner.id);
    // 2026-06 有活动
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // now = 2026-07-01（1 号，Asia/Shanghai）→ 扫描上月 = 2026-06
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(1);

    // outbox 有 recap.generate 行
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ chainId, period: '2026-06' });
  });

  it('幂等：已有 recaps 行的链不重复派发', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // 预插 recap 行
    const { randomUUID } = await import('node:crypto');
    const now = new Date();
    await db.insert(recaps).values({
      id: randomUUID(), chainId, period: '2026-06', status: 'ready',
      content: 'x', highlights: [], model: 'm', promptVersion: 1,
      generatedAt: now, createdAt: now, updatedAt: now,
    });

    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0); // 已有 recap 行，跳过
  });

  it('幂等：已有 pending outbox 行不重复派发', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    // 第一次派发
    await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    // 第二次（模拟 worker 重复扫描）
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0);

    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
  });

  it('上月无活动的链不派发', async () => {
    const chainId = await createChain(owner.id);
    // 2026-05 有活动（不在上月=2026-06 范围）
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-05-15T01:00:00Z') });
    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(0);
  });

  it('多链：仅派发上月有活动的链', async () => {
    const activeChain = await createChain(owner.id, '活跃');
    const inactiveChain = await createChain(owner.id, '不活跃');
    await insertMoment({ chainId: activeChain, authorId: owner.id, happenedAt: new Date('2026-06-15T01:00:00Z') });
    await insertMoment({ chainId: inactiveChain, authorId: owner.id, happenedAt: new Date('2026-05-15T01:00:00Z') });

    const result = await runRecapSweep(new Date('2026-07-01T00:00:00Z'));
    expect(result.dispatched).toBe(1);
    const rows = await db.select().from(outbox).where(eq(outbox.type, 'recap.generate'));
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ chainId: activeChain });
  });
});
