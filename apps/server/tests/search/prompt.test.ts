import { INTENT_SYSTEM_PROMPT, buildIntentSystemPrompt, buildIntentUserPrompt } from '../../src/search/prompt.js';

describe('意图系统 prompt（spec §3.1 逐字）', () => {
  it('buildIntentSystemPrompt 就是 INTENT_SYSTEM_PROMPT', () => {
    expect(buildIntentSystemPrompt()).toBe(INTENT_SYSTEM_PROMPT);
  });

  it('含 JSON 四字段、不抽标签、不抽我你咱们、北半球季节闭区间', () => {
    const p = INTENT_SYSTEM_PROMPT;
    expect(p).toContain('personNames');
    expect(p).toContain('place');
    expect(p).toContain('time');
    expect(p).toContain('text');
    expect(p).toContain('不要抽标签名');
    expect(p).toContain('不抽「我」「你」「咱们」');
    expect(p).toContain('春 03-01～05-31');
    expect(p).toContain('夏 06-01～08-31');
    expect(p).toContain('秋 09-01～11-30');
    expect(p).toContain('冬 12-01～次年 02-28（闰年 02-29）');
    expect(p).toContain('from=该本地日 00:00:00.000、to=该本地日 23:59:59.999');
    expect(p).toContain('「去年夏天」= 查看者今年-1 的夏天');
    expect(p).not.toContain('tagId');
    expect(p).not.toContain('tags');
  });
});

describe('意图 user prompt', () => {
  it('含查询、查看者本地日期、时区偏移分钟', () => {
    const u = buildIntentUserPrompt('去年今天和外婆', '2026-08-29', -480);
    expect(u).toContain('# 查询');
    expect(u).toContain('去年今天和外婆');
    expect(u).toContain('# 查看者本地日期');
    expect(u).toContain('2026-08-29');
    expect(u).toContain('# 时区偏移分钟');
    expect(u).toContain('-480');
  });
});
