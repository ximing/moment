import {
  EXTRACT_MAX_INPUT_CHARS,
  buildExtractSystemPrompt,
  buildExtractUserPrompt,
} from '../../../src/llm/extract/prompt.js';

describe('buildExtractSystemPrompt（spec people-place §5 抽取规则）', () => {
  it('要求返回 JSON {persons, places} 且声明输出结构', () => {
    const sys = buildExtractSystemPrompt();
    expect(sys).toContain('JSON');
    expect(sys).toContain('persons');
    expect(sys).toContain('places');
    expect(sys).toContain('[]'); // 空数组合法（没有人物/地点）
  });

  it('人物规则：亲属称谓原样抽、第一/二人称不抽（spec §5）', () => {
    const sys = buildExtractSystemPrompt();
    expect(sys).toContain('亲属称谓');
    expect(sys).toContain('第一人称');
    expect(sys).toContain('第二人称');
  });

  it('地点规则：地名与场所短语、不臆造（spec §5）', () => {
    const sys = buildExtractSystemPrompt();
    expect(sys).toContain('场所');
    expect(sys).toContain('不要臆造');
  });
});

describe('buildExtractUserPrompt（spec §5 素材 + 成本护栏）', () => {
  it('含正文与语音转写两段素材', () => {
    const user = buildExtractUserPrompt('今天在外婆家吃饭', '朵朵说了一整天的话');
    expect(user).toContain('今天在外婆家吃饭');
    expect(user).toContain('朵朵说了一整天的话');
  });

  it('transcript 为 null → 声明无语音转写；正文为空 → 声明无正文（voice 时刻主素材是转写）', () => {
    const user = buildExtractUserPrompt('', null);
    expect(user).toContain('（无正文）');
    expect(user).toContain('（无语音转写）');
  });

  it('transcript 为空串（转写成功但无文本）→ 声明转写为空，与 null 区分', () => {
    const user = buildExtractUserPrompt('正文', '');
    expect(user).toContain('（语音转写为空）');
  });

  it('超长素材各截断 2000 字符并声明截断（spec §5 成本护栏：prompt 内声明截断）', () => {
    expect(EXTRACT_MAX_INPUT_CHARS).toBe(2000);
    const content = '甲'.repeat(EXTRACT_MAX_INPUT_CHARS + 500);
    const transcript = '乙'.repeat(EXTRACT_MAX_INPUT_CHARS + 500);
    const user = buildExtractUserPrompt(content, transcript);
    expect(user).toContain('甲'.repeat(EXTRACT_MAX_INPUT_CHARS));
    expect(user).not.toContain('甲'.repeat(EXTRACT_MAX_INPUT_CHARS + 1));
    expect(user).toContain('乙'.repeat(EXTRACT_MAX_INPUT_CHARS));
    expect(user).not.toContain('乙'.repeat(EXTRACT_MAX_INPUT_CHARS + 1));
    expect(user.match(/已截断/g)?.length).toBe(2); // 两段各自声明
  });
});
