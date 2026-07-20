import {
  PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from '../../../src/llm/recap/prompt.js';
import type { RecapInput } from '../../../src/llm/recap/input.js';

describe('PROMPT_VERSION', () => {
  it('锁定为 1', () => {
    expect(PROMPT_VERSION).toBe(1);
  });
});

describe('buildSystemPrompt（spec §4.5）', () => {
  it('要求返回 JSON {content: markdown, highlight_moment_ids: string[]}', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('JSON');
    expect(sys).toContain('content');
    expect(sys).toContain('highlight_moment_ids');
    expect(sys).toContain('string[]'); // 强调 id 是字符串（UUID）
  });
});

describe('buildUserPrompt', () => {
  it('含链名、period、月龄、moments 序列化行、评论、截断声明', () => {
    const input: RecapInput = {
      moments: [
        {
          line: '[07-01 08:30] 妈妈 【里程碑】第一次微笑 宝宝今天会笑了',
          momentId: 'm-uuid-1',
          comments: ['好可爱', '记录下来'],
        },
      ],
      period: '2026-07',
      chainName: '宝宝成长',
      babyAge: '1 岁 3 个月',
      mediaRefs: [],
      truncated: { moments: false, chars: false, count: 1 },
    };
    const user = buildUserPrompt(input);
    expect(user).toContain('宝宝成长');
    expect(user).toContain('2026-07');
    expect(user).toContain('1 岁 3 个月');
    expect(user).toContain('[07-01 08:30] 妈妈 【里程碑】第一次微笑 宝宝今天会笑了');
    expect(user).toContain('好可爱');
    expect(user).toContain('m-uuid-1'); // momentId 进 prompt（供 highlight_moment_ids 引用）
  });

  it('截断发生时声明条数', () => {
    const input: RecapInput = {
      moments: [],
      period: '2026-07',
      chainName: '链',
      mediaRefs: [],
      truncated: { moments: true, chars: false, count: 5 },
    };
    const user = buildUserPrompt(input);
    expect(user).toContain('5');
    expect(user.toLowerCase()).toMatch(/truncat|截断|条/);
  });

  it('无活动链：声明 0 条', () => {
    const input: RecapInput = {
      moments: [],
      period: '2026-07',
      chainName: '空链',
      mediaRefs: [],
      truncated: { moments: false, chars: false, count: 0 },
    };
    const user = buildUserPrompt(input);
    expect(user).toContain('0');
  });
});
