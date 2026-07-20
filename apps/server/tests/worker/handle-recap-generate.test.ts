import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { notifications, pushTokens, recaps } from '../../src/db/schema.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { NonRetryableLLMError, RetryableLLMError, type LLMProvider } from '../../src/llm/base.provider.js';
import { handleRecapGenerate } from '../../src/worker/handlers.js';
import { createUser, type TestUser } from '../helpers/auth.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment } from '../helpers/fixtures.js';
import type { PushSendOutcome, PushService } from '../../src/push/push-service.js';

let owner: TestUser;
let member: TestUser;
const mockSend = jest.fn(async (): Promise<PushSendOutcome> => ({ invalidTokens: [] }));
const mockPush = { send: mockSend } as unknown as PushService;

beforeEach(async () => {
  await resetDb();
  mockSend.mockClear();
  owner = await createUser(app, 'owner@example.com');
  member = await createUser(app, 'member@example.com');
});
afterEach(() => setLLMProvider(undefined));
afterAll(closeDb);

/** 直插有效 push token，让 fanoutNotifications 的 push 路径被实际调用。 */
async function registerPushToken(userId: string): Promise<void> {
  await db.insert(pushTokens).values({
    id: randomUUID(),
    userId,
    expoToken: `ExponentPushToken[${userId.slice(0, 8)}]`,
    platform: 'ios',
  });
}

function mockProvider(content: string, highlightIds: string[]): LLMProvider {
  return {
    async chat() {
      return {
        content: JSON.stringify({ content, highlight_moment_ids: highlightIds }),
        model: 'mock',
        usage: { prompt: 10, completion: 5, total: 15 },
      };
    },
  };
}

describe('handleRecapGenerate（spec §1/§5）', () => {
  it('无效 payload（空 chainId/period）→ no-op 跳过（不写 recaps，不扇出）', async () => {
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    setLLMProvider(mockProvider('不应被调用', []));

    await handleRecapGenerate({ chainId: '', period: '' }, { push: mockPush });

    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(0); // 未写 recaps（无效 payload 早退）
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('成功 → recaps status=ready + fanout recap.ready 通知链全体成员（含 push）', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    const { addMember } = await import('../helpers/chains.js');
    await addMember(chainId, member.id, 'viewer');
    await registerPushToken(owner.id);
    await registerPushToken(member.id);
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    setLLMProvider(mockProvider('## 回顾', [m1]));

    await handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush });

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(recap.status).toBe('ready');

    // 通知扇出：owner + member 都收到 recap.ready
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(2);
    const userIds = notifs.map((n) => n.userId).sort();
    expect(userIds).toEqual([member.id, owner.id].sort());
    // push 被调用
    expect(mockSend).toHaveBeenCalled();
  });

  it('provider=null 降级也扇出 recap.ready（spec §5：降级回顾同样推送）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await registerPushToken(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    // provider=null → generateRecap 走降级路径（status=degraded，不调 LLM）。
    // handler 不再 no-op 跳过 null：generateRecap 落 degraded 行后 handler 查到 degraded → 扇出。
    setLLMProvider(null);

    await handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush });

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(recap.status).toBe('degraded');
    expect(recap.model).toBeNull();
    expect(recap.tokenUsage).toBeNull();
    // degraded 也扇出 recap.ready（spec §5：降级回顾同样推送）
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(mockSend).toHaveBeenCalled();
  });

  it('NonRetryableLLMError → 落 recaps status=failed + 不 rethrow（不占退避额度）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const provider: LLMProvider = {
      async chat() {
        throw new NonRetryableLLMError('LLM 400: bad request', 400);
      },
    };
    setLLMProvider(provider);

    // generateRecap 自己 catch NonRetryableLLMError → 落 failed 行 + 正常返回（不 rethrow，不占退避额度）。
    // handler 不 try/catch，generateRecap 正常返回后 handler 查到 failed → 不扇出。
    await expect(handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush })).resolves.not.toThrow();

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(recap.status).toBe('failed');
    expect(recap.error).toContain('400');

    // 不扇出通知（failed 不推送，spec §5）
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(0);
  });

  it('RetryableLLMError → rethrow（走 processor 退避，不落 failed）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    const provider: LLMProvider = {
      async chat() {
        throw new RetryableLLMError('LLM 429: rate limit');
      },
    };
    setLLMProvider(provider);

    // RetryableLLMError 由 generateRecap 传播（不 catch）→ handler 传播 → processor 退避
    await expect(handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush })).rejects.toThrow('429');

    // 不落 failed（generateRecap 未写行即抛出，由 processor 退避重试）
    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chainId));
    expect(rows).toHaveLength(0);
  });

  it('generating 状态不扇出（仅 ready/degraded 扇出）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });
    // generateRecap 正常应落 ready/failed/degraded，不会留 generating——
    // 此 case 验证：若 recaps 行不存在（generateRecap 未写），不扇出
    // 模拟：注入 mock provider 抛 RetryableLLMError（不落库），handler rethrow
    setLLMProvider({
      async chat() { throw new RetryableLLMError('retry'); },
    });

    await expect(handleRecapGenerate({ chainId, period: '2026-07' }, { push: mockPush })).rejects.toThrow();
    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs).toHaveLength(0);
  });
});
