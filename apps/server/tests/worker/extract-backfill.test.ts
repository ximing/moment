import { jest } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments, outbox } from '../../src/db/schema.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { runExtractBackfillSweep } from '../../src/worker/extract-backfill.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

beforeEach(async () => {
  await resetDb();
  // sweep 只检查 getLLMProvider() !== null，不调 chat——注入占位 provider
  //（对齐 recap-scheduler.test.ts 范式；空 key 用例在自身内部 setLLMProvider(undefined) 重置）
  setLLMProvider({} as unknown as LLMProvider);
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

async function extractRows() {
  return db.select().from(outbox).where(eq(outbox.type, 'moment.extract'));
}

describe('runExtractBackfillSweep（spec people-place §5 存量回填）', () => {
  it('分批：3 条有素材时刻、batchSize=2 → 单次调用内循环派发 3 行（payload {momentId}）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await insertMoment({
          chainId,
          authorId: owner.id,
          happenedAt: new Date('2026-08-01T00:00:00Z'),
          content: `在外婆家第${i}天`,
        }),
      );
    }

    const result = await runExtractBackfillSweep({ batchSize: 2, pauseMs: 0 });
    expect(result.dispatched).toBe(3);

    const rows = await extractRows();
    expect(rows).toHaveLength(3);
    const payloads = rows.map((r) => (r.payload as { momentId: string }).momentId).sort();
    expect(payloads).toEqual([...ids].sort());
  });

  it('素材判据（spec §5 扫描条件 + 偏差 11 空串闭合）：空正文无转写 / 已软删 / 已抽取（hash 非空）不派发；仅 transcript 有素材派发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '' });
    await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '已删的素材',
      deletedAt: new Date(),
    });
    const extracted = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '已抽过' });
    await db.update(moments).set({ aiExtractHash: 'a'.repeat(64) }).where(eq(moments.id, extracted));
    const voiceOnly = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '' });
    await db.update(moments).set({ transcript: '带朵朵去了外婆家' }).where(eq(moments.id, voiceOnly));

    const result = await runExtractBackfillSweep();
    expect(result.dispatched).toBe(1);
    const rows = await extractRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ momentId: voiceOnly });
  });

  it('空 transcript 视同无素材（偏差 11）：content 空且 transcript 空串（转写成功但无文本）不派发——防跨 run 重复派发', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const emptyVoice = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '' });
    await db.update(moments).set({ transcript: '' }).where(eq(moments.id, emptyVoice));
    // 老条件（OR transcript IS NOT NULL）会把该行判为有素材而派发；handler 空素材跳过不写
    // hash → ai_extract_hash 恒 NULL → 每次 backfill 都重复派发（跨 run 不幂等），偏差 11 闭合。

    const result = await runExtractBackfillSweep();
    expect(result.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(0);
  });

  it('空 key（LLM 停用）→ 直接退出：dispatched=0、不写任何 outbox 行（spec §5）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '有素材' });

    setLLMProvider(undefined); // 重置 → 真实 config（测试库空 key → null）
    const result = await runExtractBackfillSweep();
    expect(result.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(0);
  });

  it('二跑幂等（消费后，spec §5「回填天然幂等（hash 判据）」的链路版）：第一跑派发 → mock LLM 消费写 hash → 第二跑不重扫', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({
      chainId,
      authorId: owner.id,
      happenedAt: new Date(),
      content: '今天在外婆家',
    });

    const first = await runExtractBackfillSweep();
    expect(first.dispatched).toBe(1);

    // 常驻 worker 消费（mock LLM）→ 成功后 hash 已写——sweep 二跑的 IS NULL 判据天然排除
    setLLMProvider({
      async chat() {
        return {
          content: JSON.stringify({ persons: ['外婆'], places: [] }),
          model: 'mock-model',
          usage: { prompt: 1, completion: 1, total: 2 },
        };
      },
    });
    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBe(1);
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.aiExtractHash).not.toBeNull();

    const second = await runExtractBackfillSweep();
    expect(second.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(1); // 无新行
  });

  it('pending 窗口二跑：第一跑未消费 → 第二跑去重不重复发射（对齐 recap-scheduler 范式，偏差 8）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(), content: '今天在外婆家' });

    await runExtractBackfillSweep();
    const second = await runExtractBackfillSweep();
    expect(second.dispatched).toBe(0);
    expect(await extractRows()).toHaveLength(1);
  });
});
