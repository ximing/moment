import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/index.js';
import { comments } from '../../../src/db/schema.js';
import { createUser, type TestUser } from '../../helpers/auth.js';
import { closeDb, resetDb } from '../../helpers/db.js';
import { app, createChain, insertMoment } from '../../helpers/fixtures.js';
import { buildRecapInput } from '../../../src/llm/recap/input.js';

let owner: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await createUser(app, 'owner@example.com');
});
afterAll(closeDb);

async function insertComment(momentId: string, authorId: string, content: string, createdAt: Date) {
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  await db.insert(comments).values({ id, momentId, authorId, content, createdAt });
  return id;
}

describe('buildRecapInput（spec §4）', () => {
  it('取 wall_date 落 period 内的未软删 moments，按 happenedAt 正序', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    // 2026-07 内（UTC，tz=0 → wallDate = 2026-07-01）
    const m1 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-15T03:00:00Z') });
    const m2 = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    // 2026-06（不应入选）
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-06-30T23:00:00Z') });
    // 软删（不应入选）
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-20T00:00:00Z'), deletedAt: new Date() });

    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments).toHaveLength(2);
    expect(input.moments[0].momentId).toBe(m2); // happenedAt 正序
    expect(input.moments[1].momentId).toBe(m1);
    expect(input.period).toBe('2026-07');
    expect(input.chainName).toBe('宝宝成长');
  });

  it('序列化 line：[MM-DD HH:mm] 昵称 + 正文 + payload 摘要（milestone/metric/mood/geo/standard）', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    const mMs = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T08:30:00Z'),
      content: '今天会笑了', kind: 'milestone', payload: { catalog_key: 'first-smile', note: '好开心' },
    });
    const mMt = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T08:30:00Z'),
      content: '体检', kind: 'metric', payload: { metric: 'height', value: 62, unit: 'cm' },
    });
    // custom_label 里程碑
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-03T08:30:00Z'),
      content: '叫妈妈了', kind: 'milestone', payload: { custom_label: '第一次叫妈妈' },
    });

    const input = await buildRecapInput(chainId, '2026-07');
    const msLine = input.moments.find((m) => m.momentId === mMs)!.line;
    expect(msLine).toContain('[07-01 08:30]');
    expect(msLine).toContain('【里程碑】第一次微笑');
    const mtLine = input.moments.find((m) => m.momentId === mMt)!.line;
    expect(mtLine).toContain('【记录】height 62cm');
    const customLine = input.moments.find((m) => m.momentId !== mMs && m.momentId !== mMt)!.line;
    expect(customLine).toContain('【里程碑】第一次叫妈妈');
  });

  it('daily 链 mood 摘要 + travel 链 geo 摘要 + standard 无标记', async () => {
    const daily = await createChain(owner.id, '日常', 'daily');
    await insertMoment({
      chainId: daily, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '心情不错', payload: { mood: '😄' },
    });
    const travel = await createChain(owner.id, '旅行', 'travel');
    const mG = await insertMoment({
      chainId: travel, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '到北京了', payload: { geo: { lat: 39.9, lng: 116.4, place_name: '北京' } },
    });

    const dailyInput = await buildRecapInput(daily, '2026-07');
    expect(dailyInput.moments[0].line).toContain('【心情】😄');
    const travelInput = await buildRecapInput(travel, '2026-07');
    expect(travelInput.moments.find((m) => m.momentId === mG)!.line).toContain('【位置】北京');
  });

  it('standard moment 无 kind 标记（仅正文）', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '普通记录',
    });
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments[0].line).not.toContain('【');
    expect(input.moments[0].line).toContain('普通记录');
  });

  it('非零 tzOffset：[MM-DD HH:mm] 显示本地时间（与 wall_date 同一墙钟系，非 UTC）', async () => {
    // 东八区 -480：happenedAt=2026-06-30T23:00:00Z → wall_date=2026-07-01（被选入 7 月），
    // 本地时间 = 2026-07-01 07:00（UTC+8）。formatLine 必须显示 [07-01 07:00] 而非 UTC [06-30 23:00]。
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({
      chainId, authorId: owner.id,
      happenedAt: new Date('2026-06-30T23:00:00Z'), happenedTzOffset: -480, content: '跨月边界',
    });
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments).toHaveLength(1);
    expect(input.moments[0].line).toContain('[07-01 07:00]');
    expect(input.moments[0].line).not.toContain('[06-30'); // 不显示 UTC 日期
  });

  it('精选评论：每 moment ≤2 条、按 createdAt 升序、≤100 字、排除软删', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const m = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    await insertComment(m, owner.id, '第一条评论', new Date('2026-07-01T02:00:00Z'));
    await insertComment(m, owner.id, '第二条评论', new Date('2026-07-01T03:00:00Z'));
    await insertComment(m, owner.id, '第三条评论', new Date('2026-07-01T04:00:00Z')); // 超过 2 条，应被截断
    // 软删评论（直接 update deletedAt）
    const fourth = await insertComment(m, owner.id, '已删评论', new Date('2026-07-01T05:00:00Z'));
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, fourth));

    const input = await buildRecapInput(chainId, '2026-07');
    const cm = input.moments.find((x) => x.momentId === m)!;
    expect(cm.comments).toEqual(['第一条评论', '第二条评论']); // 前 2 条 + 升序 + 排除第三与软删
  });

  it('截断护栏：超 MAX_MOMENTS 按「有 payload 优先、其次评论数」排序截取', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    // 造 3 条：1 条有 payload、2 条无 payload（其中 1 条带评论）
    const mPayload = await insertMoment({
      chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'),
      content: '有心情', payload: { mood: '😄' },
    });
    const mWithComment = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T01:00:00Z'), content: '带评论' });
    await insertComment(mWithComment, owner.id, '评论', new Date('2026-07-02T02:00:00Z'));
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-03T01:00:00Z'), content: '无评论' });

    // 临时把 MAX_MOMENTS 设为 2（通过 process.env 覆盖不可行——config 在 import 时已 parse，
    // 故用模块级注入：buildRecapInput 读 config.LLM_RECAP_MAX_MOMENTS，测试改 process.env 后重 import 不现实。
    // 改用：造足够多条让默认 100 不触发，改为直接断言排序顺序——
    // 为稳定测试截断，buildRecapInput 接受可选 opts.maxMoments/maxChars，测试注入小值）
    const input = await buildRecapInput(chainId, '2026-07', { maxMoments: 2 });
    expect(input.truncated.moments).toBe(true);
    expect(input.truncated.count).toBe(2);
    // 有 payload 优先、其次评论数：mPayload 第一，mWithComment 第二
    expect(input.moments[0].momentId).toBe(mPayload);
    expect(input.moments[1].momentId).toBe(mWithComment);
  });

  it('字符截断：总字符超 MAX_CHARS 二次截断，truncated.chars=true', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: 'A'.repeat(200) });
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-02T01:00:00Z'), content: 'B'.repeat(200) });

    const input = await buildRecapInput(chainId, '2026-07', { maxChars: 300 });
    expect(input.truncated.chars).toBe(true);
    expect(input.truncated.count).toBeLessThanOrEqual(2);
    // 总字符应被截断到 maxChars 范围内（允许最后一条完整条目少量超出）
    const totalChars = input.moments.reduce((sum, m) => sum + m.line.length + m.comments.join('').length, 0);
    expect(totalChars).toBeLessThanOrEqual(300 + 200); // 允许少量超出的最后一条
  });

  it('baby 链注入 babyAge：按 birthdate 换算 period 末月龄', async () => {
    const chainId = await createChain(owner.id, '宝宝成长', 'baby');
    // 直接更新 chains.payload 注入 birthdate（createChain 不带 payload）
    const { chains } = await import('../../../src/db/schema.js');
    await db.update(chains).set({ payload: { birthdate: '2025-05-01', gender: 'girl' } }).where(eq(chains.id, chainId));
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z'), content: '记录' });

    const input = await buildRecapInput(chainId, '2026-07');
    // period 末 = 2026-08-01（下月 1 号）；birthdate 2025-05-01 → 1 岁 3 个月
    expect(input.babyAge).toContain('1 岁');
    expect(input.babyAge).toMatch(/3 个?月/);
  });

  it('mediaRefs v1 恒为空数组', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-07-01T01:00:00Z') });
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.mediaRefs).toEqual([]);
  });

  it('无活动的链：moments 为空、truncated.count=0', async () => {
    const chainId = await createChain(owner.id, '日常', 'daily');
    const input = await buildRecapInput(chainId, '2026-07');
    expect(input.moments).toEqual([]);
    expect(input.truncated.count).toBe(0);
    expect(input.truncated.moments).toBe(false);
    expect(input.truncated.chars).toBe(false);
  });
});
