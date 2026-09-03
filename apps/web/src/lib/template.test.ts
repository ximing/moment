import { describe, expect, it } from 'vitest';
import { OFFICIAL_TEMPLATES, type MomentResponse } from '@moment/dto';
import { babyAgeLabel, groupMomentsByTrips, resolveMilestoneLabel, summarizePayload } from './template';

const baby = OFFICIAL_TEMPLATES.find((t) => t.key === 'baby')!.manifest;
const career = OFFICIAL_TEMPLATES.find((t) => t.key === 'career')!.manifest;

function momentAt(id: string, iso: string, tz = -480): MomentResponse {
  return { id, happenedAt: iso, happenedTzOffset: tz, transcript: null, transcriptionStatus: null } as MomentResponse;
}

describe('babyAgeLabel', () => {
  it('未满岁按月；满岁按岁+月；整岁只显示岁', () => {
    expect(babyAgeLabel('2026-01-15', '2026-04-20T02:00:00.000Z', -480)).toBe('3 个月');
    expect(babyAgeLabel('2025-01-10', '2026-04-20T02:00:00.000Z', -480)).toBe('1 岁 3 个月');
    expect(babyAgeLabel('2022-04-20', '2026-04-20T02:00:00.000Z', -480)).toBe('4 岁');
  });

  it('按发生地墙钟日计算（UTC 跨日不串）', () => {
    // UTC 4-30 16:30 = 东八区 5-01 00:30 → 按 5 月 1 日算
    expect(babyAgeLabel('2026-01-01', '2026-04-30T16:30:00.000Z', -480)).toBe('4 个月');
  });
});

describe('groupMomentsByTrips', () => {
  const trips = [
    { name: '云南', start: '2026-05-01', end: '2026-05-05' },
    { name: '东京', start: '2026-06-10', end: '2026-06-15' },
  ];

  it('墙钟日落入对应行程；行程外进 outside；章节按 start 倒序', () => {
    const inYunnan = momentAt('a', '2026-05-02T16:00:00.000Z'); // 东八区 5-03
    const inTokyo = momentAt('b', '2026-06-12T01:00:00.000Z'); // 东八区 6-12
    const outside = momentAt('c', '2026-07-01T00:00:00.000Z');
    const { sections, outside: out } = groupMomentsByTrips([inYunnan, inTokyo, outside], trips);
    expect(sections.map((s) => s.name)).toEqual(['东京', '云南']);
    expect(sections[0]!.moments.map((m) => m.id)).toEqual(['b']);
    expect(sections[1]!.moments.map((m) => m.id)).toEqual(['a']);
    expect(out.map((m) => m.id)).toEqual(['c']);
  });

  it('行程边界含首尾日；无行程时全部 outside', () => {
    const first = momentAt('a', '2026-04-30T16:30:00.000Z'); // 东八区 5-01
    const last = momentAt('b', '2026-05-05T15:59:00.000Z'); // 东八区 5-05 23:59
    const { sections } = groupMomentsByTrips([first, last], trips);
    expect(sections.find((s) => s.name === '云南')!.moments).toHaveLength(2);
    expect(groupMomentsByTrips([first], []).outside).toHaveLength(1);
  });
});

describe('resolveMilestoneLabel / summarizePayload', () => {
  it('catalog_key 命中目录给 label+icon；custom_label 回退；未知 key 用原文', () => {
    expect(resolveMilestoneLabel(baby, { catalog_key: 'first-smile' })).toEqual({
      label: '第一次微笑',
      icon: 'milestone-first-smile',
    });
    expect(resolveMilestoneLabel(baby, { custom_label: '第一次叫妈妈' })).toEqual({ label: '第一次叫妈妈', icon: null });
    expect(resolveMilestoneLabel(baby, { catalog_key: 'not-in-catalog' })).toEqual({ label: 'not-in-catalog', icon: null });
  });

  it('summarizePayload：milestone 用 label；metric 用中文摘要；standard 返回空串', () => {
    expect(summarizePayload(baby, 'milestone', { catalog_key: 'first-steps' })).toBe('第一次走路');
    expect(summarizePayload(baby, 'metric', { metric: 'height', value: 62, unit: 'cm' })).toBe('身高 62cm');
    expect(summarizePayload(baby, 'metric', { metric: 'weight', value: 7.5, unit: 'kg' })).toBe('体重 7.5kg');
    expect(summarizePayload(baby, 'standard', { mood: '😄' })).toBe('');
  });
});

describe('summarizePayload 泛化（spec §5）', () => {
  it('career-event 含 catalog_key 出目录 label', () => {
    expect(summarizePayload(career, 'career-event', { catalog_key: 'promotion' })).toBe('晋升');
  });
  it('career-event 含 custom_label 出原文', () => {
    expect(summarizePayload(career, 'career-event', { custom_label: '内部转组' })).toBe('内部转组');
  });
  it('reflection 出 topic', () => {
    expect(summarizePayload(career, 'reflection', { topic: '要不要接这个机会' })).toBe('要不要接这个机会');
  });
  it('baby milestone 摘要回归不变', () => {
    expect(summarizePayload(baby, 'milestone', { catalog_key: 'first-steps' })).toBe('第一次走路');
  });
  it('metric 分支不变', () => {
    expect(summarizePayload(baby, 'metric', { metric: 'height', value: 52, unit: 'cm' })).toBe('身高 52cm');
  });
  it('未知 payload 返回空串兜底不变', () => {
    expect(summarizePayload(career, 'whatever', { foo: 1 })).toBe('');
    expect(summarizePayload(career, 'standard', null)).toBe('');
  });
});
