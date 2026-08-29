import { describe, expect, it } from 'vitest';
import type { SearchParsed } from '@moment/dto';
import { formatSearchParsed } from './search-summary';

describe('formatSearchParsed', () => {
  it('拼接人物、地点、墙钟日、剩余 text', () => {
    const parsed: SearchParsed = {
      personNames: ['外婆'],
      place: '朝阳公园',
      time: { kind: 'wall_date', year: 2025, month: 8, day: 29 },
      text: '野餐',
    };
    expect(formatSearchParsed(parsed)).toBe('找到：外婆 · 朝阳公园 · 2025年8月29日 · 野餐');
  });

  it('降级 parsed（仅 text=q）不额外提示模型失败', () => {
    const parsed: SearchParsed = { personNames: [], place: null, time: null, text: '去年今天和外婆' };
    expect(formatSearchParsed(parsed)).toBe('找到：去年今天和外婆');
  });
});
