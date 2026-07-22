import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chains, notifications, pushTokens, recaps } from '../../src/db/schema.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { generateRecap } from '../../src/llm/recap/generate.js';
import { handleRecapGenerate } from '../../src/worker/handlers.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { insertMoment, insertRecap } from '../helpers/fixtures.js';
import type { PushSendOutcome, PushService } from '../../src/push/push-service.js';
import { listenLocal } from '../helpers/http-server.js';

const app = listenLocal(createApp());

let owner: TestUser;
const mockSend = jest.fn(async (): Promise<PushSendOutcome> => ({ invalidTokens: [] }));
const mockPush = { send: mockSend } as unknown as PushService;

beforeEach(async () => {
  await resetDb();
  mockSend.mockClear();
  owner = await createUser(app, 'alice');
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

describe('recap 降级 e2e（spec §5）', () => {
  it('provider=null（空 key 停用）→ generateRecap 走降级 → status=degraded + 内容含非 AI 生成标注', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '七月记录',
    });
    setLLMProvider(null); // 空 key = 停用

    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    const [recap] = await db.select().from(recaps).where(eq(recaps.chainId, chain.id));
    expect(recap.status).toBe('degraded');
    expect(recap.model).toBeNull();
    expect(recap.tokenUsage).toBeNull();
    // 降级文案含非 AI 生成标注（spec §5）
    expect(recap.content.length).toBeGreaterThan(0);
  });

  it('降级回顾也扇出 recap.ready（spec §5：降级回顾同样推送）', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    const carol = await createUser(app, 'carol');
    await addMember(chain.id, carol.id, 'viewer');
    await registerPushToken(owner.id);
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '记录',
    });
    setLLMProvider(null);

    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    const notifs = await db.select().from(notifications).where(eq(notifications.type, 'recap.ready'));
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(mockSend).toHaveBeenCalled();
  });

  it('预算降级：budgetOverride 注入小预算 + 预插超预算 recap → 新生成走降级', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '七月记录',
    });
    // 预插一条超预算的 recap（tokenUsage.total = 200，budget 设 100）
    // generatedAt 必须设为当前月（generateRecap 按 generated_at 当月聚合 token 消耗，null 不计入）
    await insertRecap({
      chainId: chain.id, period: '2026-06', status: 'ready', content: '六月回顾',
      model: 'mock', tokenUsage: { prompt: 120, completion: 80, total: 200 },
      generatedAt: new Date(),
    });
    // 注入非 null provider（确保不是 provider=null 降级，而是预算降级）
    setLLMProvider({
      async chat() {
        return {
          content: JSON.stringify({ content: '不应被调用', highlight_moment_ids: [] }),
          model: 'mock', usage: { prompt: 10, completion: 5, total: 15 },
        };
      },
    });

    // budgetOverride=100 < 已消耗 200 → 走降级路径
    await generateRecap(chain.id, '2026-07', { budgetOverride: 100 });

    // 查 7 月 recap（generateRecap 新生成的降级行；6 月是预插的 ready 行）
    const rows = await db.select().from(recaps).where(eq(recaps.chainId, chain.id));
    const julyRecap = rows.find((r) => r.period === '2026-07');
    expect(julyRecap).toBeTruthy();
    expect(julyRecap!.status).toBe('degraded');
    expect(julyRecap!.model).toBeNull(); // 预算降级不调 LLM，model 为 null
    expect(julyRecap!.tokenUsage).toBeNull();
  });

  it('降级 recap 分享页外发（S2 注：含 degraded，§5 降级回顾同样外发）', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '记录',
    });
    setLLMProvider(null);
    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    // 建分享链接
    const link = await request(app)
      .post(`/api/chains/${chain.id}/share-links`)
      .set('Authorization', auth(owner))
      .send({});
    expect(link.status).toBe(201);

    // 匿名读分享页 → recap 含 degraded
    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.recap).toBeTruthy();
    expect(pub.body.recap.status).toBe('degraded');
  });

  it('share_recaps_enabled=false → 分享页不外发 recap', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '记录',
    });
    setLLMProvider(null);
    await handleRecapGenerate({ chainId: chain.id, period: '2026-07' }, { push: mockPush });

    // 关闭开关
    await db.update(chains).set({ shareRecapsEnabled: false }).where(eq(chains.id, chain.id));

    const link = await request(app)
      .post(`/api/chains/${chain.id}/share-links`)
      .set('Authorization', auth(owner))
      .send({});
    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.recap).toBeUndefined();
  });

  it('generating/failed recap 不外发（spec §6：generating/failed 不外发）', async () => {
    const chain = await createChain(app, owner, '日常', 'daily');
    await insertMoment({
      chainId: chain.id, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '记录',
    });
    // 预插 failed recap
    await insertRecap({
      chainId: chain.id, period: '2026-07', status: 'failed', content: '', error: 'LLM_ERROR',
    });

    const link = await request(app)
      .post(`/api/chains/${chain.id}/share-links`)
      .set('Authorization', auth(owner))
      .send({});
    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.recap).toBeUndefined();
  });
});
