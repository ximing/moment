import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { recaps } from '../../../src/db/schema.js';
import { setLLMProvider } from '../../../src/llm/factory.js';
import { NonRetryableLLMError, type LLMProvider } from '../../../src/llm/base.provider.js';
import { generateRecap } from '../../../src/llm/recap/generate.js';
import { createUser, type TestUser } from '../../helpers/auth.js';
import { closeDb, resetDb } from '../../helpers/db.js';
import { app, createChain, insertMoment } from '../../helpers/fixtures.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterEach(() => setLLMProvider(undefined)); // 重置回真实 config（p2 三态）
afterAll(closeDb);

/** mock provider 工厂：chat 返回指定 content + highlight_moment_ids + usage，并记录调用次数 */
function mockProvider(
  content: string,
  highlightIds: string[],
  usage = { prompt: 100, completion: 50, total: 150 },
): LLMProvider & { calls: number } {
  const holder: { calls: number } = { calls: 0 };
  const provider: LLMProvider & { calls: number } = {
    get calls() {
      return holder.calls;
    },
    async chat() {
      holder.calls++;
      return {
        content: JSON.stringify({ content, highlight_moment_ids: highlightIds }),
        model: 'mock-model',
        usage,
      };
    },
  };
  return provider;
}

describe('generateRecap 成功路径（spec §5）', () => {
  it('provider 返回合法 JSON → upsert recaps 行 status=ready + 透传 usage', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T01:00:00Z'), content: '记录二' });
    const provider = mockProvider('## 7月回顾\n本月记录了...', [m1, m2]);
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('ready');
    expect(row.content).toBe('## 7月回顾\n本月记录了...');
    expect(row.highlights).toEqual([m1, m2]);
    expect(row.model).toBe('mock-model');
    expect(row.promptVersion).toBe(1);
    expect(row.tokenUsage).toEqual({ prompt: 100, completion: 50, total: 150 });
    expect(row.error).toBeNull();
    expect(row.generatedAt).toBeInstanceOf(Date);
  });

  it('幻觉 id 过滤：highlight_moment_ids 含不属于该链该月的 id → 过滤掉', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const fakeId = 'nonexistent-uuid-0000';
    const provider = mockProvider('回顾', [m1, fakeId, 'another-fake-uuid']);
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.highlights).toEqual([m1]); // 只保留真实存在的 m1
  });

  it('解析失败重试一次：第一次返回非法 JSON、第二次合法 → status=ready', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    let call = 0;
    const provider: LLMProvider = {
      async chat() {
        call++;
        if (call === 1) return { content: 'not json {', model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
        return { content: JSON.stringify({ content: '重试成功', highlight_moment_ids: [m1] }), model: 'm', usage: { prompt: 2, completion: 2, total: 4 } };
      },
    };
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('ready');
    expect(row.content).toBe('重试成功');
    expect(call).toBe(2);
  });

  it('解析两次都失败 → status=failed + error 摘要', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const provider: LLMProvider = {
      async chat() {
        return { content: 'still not json', model: 'm', usage: { prompt: 1, completion: 1, total: 2 } };
      },
    };
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('failed');
    expect(row.error).toContain('parse');
    expect(row.model).toBeNull();
    expect(row.tokenUsage).toBeNull();
    expect(row.generatedAt).toBeInstanceOf(Date);
  });
});

describe('generateRecap 预算降级（spec §5）', () => {
  it('provider=null → 降级路径：status=degraded、不调 provider、tokenUsage=null、model=null', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    setLLMProvider(null);

    await generateRecap(chainId, '2026-07');

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('degraded');
    expect(row.model).toBeNull();
    expect(row.tokenUsage).toBeNull();
    expect(row.content).toContain('本月记录');
    expect(row.content).toContain('非 AI 生成');
    expect(row.generatedAt).toBeInstanceOf(Date);
    // m1 only used for validMomentIds; not asserted here beyond status
    void m1;
  });

  it('buildDegradedContent：规则文案「本月记录 N 条」+ 里程碑列表 + 标注非 AI 生成', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    const m1 = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '会笑了', kind: 'milestone', payload: { catalog_key: 'first-smile' },
    });
    setLLMProvider(null);

    await generateRecap(chainId, '2026-07');

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('degraded');
    expect(row.content).toContain('本月记录 1 条');
    expect(row.content).toContain('第一次微笑'); // 里程碑 label
    expect(row.content).toContain('非 AI 生成');
    expect(row.highlights).toEqual([m1]); // 降级也填 highlights（结构化记录的 id）
  });

  it('超月度预算 → 降级路径（budgetOverride 注入 + 当月已耗超 budget）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    // 先插一条已 ready 的 recap 模拟当前月已消耗超 budget。
    // monthlyTokenUsage 按「当前运行月」开窗（spec §5「当月」= 当前运行月，非 period 月），
    // 故 generatedAt 用 new Date()（当前月），使其落在 monthlyTokenUsage 的当月窗口内。
    const otherChain = await createChain(owner.id, '其他链', 'daily');
    const now = new Date();
    const { randomUUID } = await import('node:crypto');
    await db.insert(recaps).values({
      id: randomUUID(), chainId: otherChain, period: '2026-07', status: 'ready',
      content: 'x', highlights: [], model: 'm', promptVersion: 1,
      tokenUsage: { prompt: 999999, completion: 999999, total: 999999 }, // 远超 budget
      generatedAt: now, createdAt: now, updatedAt: now,
    });
    const provider = mockProvider('不应被调用', []);
    setLLMProvider(provider);
    // budgetOverride=1：config.LLM_MONTHLY_TOKEN_BUDGET 默认 0=不限（import 时 parse 无法 env 覆盖），
    // 故用 opts.budgetOverride 测试注入点强制 budget=1，使预插 recap 的 999999 token 超限走降级。
    await generateRecap(chainId, '2026-07', { provider, budgetOverride: 1 });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('degraded');
    expect(provider.calls).toBe(0); // 未调 provider
  });

  it('NonRetryableLLMError → generateRecap 自己落 failed 行 + 不 rethrow（不扇出，p3 只查 recaps 行）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    const provider: LLMProvider = {
      async chat() {
        throw new NonRetryableLLMError('LLM 400: bad request', 400);
      },
    };
    setLLMProvider(provider);

    // generateRecap 内部 catch NonRetryableLLMError → 落 failed 行 + 正常返回（不 rethrow）
    await generateRecap(chainId, '2026-07', { provider });

    const [row] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(row.status).toBe('failed');
    expect(row.error).toContain('400');
    expect(row.model).toBeNull();
    expect(row.tokenUsage).toBeNull();
    expect(row.generatedAt).toBeInstanceOf(Date);
  });
});

describe('generateRecap 重生成 upsert（spec §2）', () => {
  it('已存在 recap 行 → 覆盖 content/highlights/status/model/tokenUsage，保留 created_at', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录一' });
    // 先插一条 generating 行
    const oldCreated = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
    const { randomUUID } = await import('node:crypto');
    await db.insert(recaps).values({
      id: randomUUID(), chainId, period: '2026-07', status: 'generating',
      content: '', highlights: [], promptVersion: 1, createdAt: oldCreated, updatedAt: oldCreated,
    });
    const provider = mockProvider('重新生成的内容', [m1]);
    setLLMProvider(provider);

    await generateRecap(chainId, '2026-07', { provider });

    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(1); // upsert 不新增
    expect(rows[0].status).toBe('ready');
    expect(rows[0].content).toBe('重新生成的内容');
    // created_at 列 fsp=0（与 moments.createdAt 同约定，秒级精度），按秒比较保留情况（未被重置为 now）
    expect(Math.floor(rows[0].createdAt.getTime() / 1000)).toBe(Math.floor(oldCreated.getTime() / 1000));
  });
});
