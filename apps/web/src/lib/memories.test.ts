import { describe, expect, it } from 'vitest';
import type { MemoriesYearGroup, MomentResponse } from '@moment/dto';
import { memoriesBarText, summarizeMemories, todayKey } from './memories';

// 那年今日入口条纯逻辑（spec memories-today §4）：文案语义、count 汇总、空结果不渲染。

function moment(id: string): MomentResponse {
  return {
    id,
    chainId: 'chain-1',
    author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
    type: 'text',
    kind: 'standard',
    payload: null,
    content: id,
    transcript: null,
    transcriptionStatus: null,
    happenedAt: '2025-08-19T02:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2025-08-19T02:00:00.000Z',
    media: [],
    tags: [],
    persons: [],
    place: null,
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
}

const GROUPS: MemoriesYearGroup[] = [
  { year: 2025, moments: [moment('a'), moment('b')] },
  { year: 2020, moments: [moment('c')] },
];

describe('summarizeMemories', () => {
  it('N = 最近周年距今年数（响应年份倒序，years[0] 即最近周年）', () => {
    expect(summarizeMemories(GROUPS, '2026-08-19')).toEqual({ yearsAgo: 1, count: 3 });
    expect(summarizeMemories(GROUPS, '2030-08-19')?.yearsAgo).toBe(5);
  });

  it('count 为全部分组的总条数', () => {
    expect(summarizeMemories(GROUPS, '2026-08-19')?.count).toBe(3);
    expect(summarizeMemories([{ year: 2024, moments: [moment('a')] }], '2026-08-19')?.count).toBe(1);
  });

  it('空结果返回 null（入口条不渲染）', () => {
    expect(summarizeMemories([], '2026-08-19')).toBeNull();
  });
});

describe('memoriesBarText', () => {
  it('spec §4 文案：{N} 年前的今天 · 共 {count} 条', () => {
    expect(memoriesBarText({ yearsAgo: 1, count: 3 })).toBe('1 年前的今天 · 共 3 条');
  });
});

describe('todayKey', () => {
  it('取查看者本地日期 YYYY-MM-DD', () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(todayKey(now)).toBe(expected);
  });
});
