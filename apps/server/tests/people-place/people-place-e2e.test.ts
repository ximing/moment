import { jest } from '@jest/globals';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import type { LLMProvider } from '../../src/llm/base.provider.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, registerUser } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

beforeEach(resetDb);
afterEach(() => {
  setGeocodeProvider(undefined);
  setLLMProvider(undefined);
});
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const MOCK_PLACE_NAME = '北京市东城区东华门街道天安门广场';

/** mock geocode provider（P3 范式）：返回固定地名，记录收到的 WGS-84 坐标。 */
function geocodeReturning(name: string | null, seen?: Array<{ lat: number; lng: number }>): GeocodeProvider {
  return {
    reverse: async (lat, lng) => {
      seen?.push({ lat, lng });
      return name;
    },
  };
}

/** mock LLM provider（P4 范式）：chat 返回抽取 JSON，记录调用次数。 */
function llmReturning(persons: string[], places: string[], counter?: { calls: number }): LLMProvider {
  return {
    async chat() {
      if (counter) counter.calls += 1;
      return {
        content: JSON.stringify({ persons, places }),
        model: 'mock-model',
        usage: { prompt: 10, completion: 5, total: 15 },
      };
    },
  };
}

const baseBody = {
  type: 'text' as const,
  happenedAt: '2026-08-20T10:00:00+08:00',
  happenedTzOffset: -480,
};

describe('people-place 全链路 e2e（spec §1 数据流 / §9 e2e 条目）', () => {
  it('建时刻带人物+坐标 → 响应回读（manual/exif）→ geocode mock 回填 + AI mock 补缺 → 详情/feed 完整回读', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);

    // 人物词典经真实 POST 创建（spec §6）
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);
    expect(person.body).toEqual({ id: expect.any(String), name: '外婆', userId: null });

    // 建时刻：personIds（manual 意图）+ 仅坐标（EXIF 形态 → exif 分支）
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({
        ...baseBody,
        content: '今天在外婆家吃饭，朵朵很开心',
        personIds: [person.body.id],
        place: { lat: 39.9042, lng: 116.4074 },
      });
    expect(created.status).toBe(201);
    // 响应回读：source 只由 server 赋值（spec §3/§6 赋值表）
    expect(created.body.persons).toEqual([
      { id: person.body.id, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(created.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
    const momentId = created.body.id as string;

    // 同事务发射 moment.geocode（payload camelCase，P2 偏差 1）
    const geocodeRows = await db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
    expect(geocodeRows).toHaveLength(1);
    expect(geocodeRows[0].payload).toEqual({ momentId, lat: 39.9042, lng: 116.4074 });

    // mock provider 注入 + 常驻 worker 真实分发（默认 handlers 注册表：created/geocode/extract 一批全消费）
    const geocodeSeen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning(MOCK_PLACE_NAME, geocodeSeen));
    setLLMProvider(llmReturning(['朵朵'], []));

    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(3); // moment.created + moment.geocode + moment.extract
    expect(batch.failed).toBe(0);
    expect(geocodeSeen).toEqual([{ lat: 39.9042, lng: 116.4074 }]); // WGS-84 行坐标直达 provider

    // 详情回读：geocode 名回填（source 仍 exif，不被 AI 触碰——place 非空不覆盖）；AI 人物仅补缺（外婆 manual 不降级、朵朵 ai 新增）
    const detail = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    const persons = [...detail.body.persons].sort(
      (a: { source: string }, b: { source: string }) => a.source.localeCompare(b.source),
    );
    expect(persons).toEqual([
      { id: expect.any(String), name: '朵朵', userId: null, source: 'ai' },
      { id: person.body.id, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(detail.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: MOCK_PLACE_NAME, source: 'exif' });

    // feed 路径同样完整（includePrivate: true 批取序列化）
    const feed = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&order=happened_at`)
      .set(auth(owner.token));
    expect(feed.status).toBe(200);
    const feedItem = feed.body.moments.find((m: { id: string }) => m.id === momentId);
    expect(feedItem.persons).toHaveLength(2);
    expect(feedItem.place).toEqual({ lat: 39.9042, lng: 116.4074, name: MOCK_PLACE_NAME, source: 'exif' });

    // outbox 全部终态（done），无重试/失败残留
    const pending = await db.select().from(outbox).where(eq(outbox.status, 'pending'));
    expect(pending).toHaveLength(0);
  });

  it('AI 抽取补缺 place：place 四列全空时填文本名（source=ai 无坐标）→ 响应回读（spec §5）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, content: '今天去了朝阳公园玩' });
    expect(created.status).toBe(201);
    expect(created.body.place).toBeNull();

    setLLMProvider(llmReturning([], ['朝阳公园']));
    const batch = await runOutboxBatch({ push: mockPush });
    expect(batch.done).toBeGreaterThanOrEqual(2); // moment.created + moment.extract
    expect(batch.failed).toBe(0);

    const detail = await request(app).get(`/api/moments/${created.body.id}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body.place).toEqual({ lat: null, lng: null, name: '朝阳公园', source: 'ai' });
  });
});

describe('三路径序列化 + share-album 隐私红线（spec §8，键级断言）', () => {
  it('链时间线/详情/feed 含 persons/place；share-album 输出零 persons/place 键', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);

    // 坐标 + 名字 → manual（§6 赋值表第一行），不触发 geocode
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({
        ...baseBody,
        content: '在外婆家过年',
        personIds: [person.body.id],
        place: { name: '外婆家', lat: 39.9, lng: 116.4 },
      });
    expect(created.status).toBe(201);
    expect(created.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });
    const momentId = created.body.id as string;

    // 路径 1：链时间线
    const list = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(list.status).toBe(200);
    const listItem = list.body.items.find((m: { id: string }) => m.id === momentId);
    expect(listItem.persons).toEqual([
      { id: person.body.id, name: '外婆', userId: null, source: 'manual' },
    ]);
    expect(listItem.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });

    // 路径 2：详情
    const detail = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(detail.status).toBe(200);
    expect(detail.body.persons).toHaveLength(1);
    expect(detail.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });

    // 路径 3：feed
    const feed = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&order=happened_at`)
      .set(auth(owner.token));
    expect(feed.status).toBe(200);
    const feedItem = feed.body.moments.find((m: { id: string }) => m.id === momentId);
    expect(feedItem.persons).toHaveLength(1);
    expect(feedItem.place.name).toBe('外婆家');

    // 红线：公开分享相册零 persons/place（键完全不存在，不是空数组/null 值）
    const link = await request(app)
      .post(`/api/chains/${chainId}/share-links`)
      .set(auth(owner.token))
      .send({});
    expect(link.status).toBe(201);

    const pub = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.moments).toHaveLength(1);
    const shared = pub.body.moments[0];
    expect('persons' in shared).toBe(false);
    expect('place' in shared).toBe(false);
    expect(Object.keys(shared)).not.toContain('persons');
    expect(Object.keys(shared)).not.toContain('place');
    // 同一时刻本体（content/tags 等）在分享路径照常输出——证明剥离是精确的两键级，不是整卡隐藏
    expect(shared.content).toBe('在外婆家过年');
  });
});
