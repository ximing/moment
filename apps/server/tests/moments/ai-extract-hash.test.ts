import { createHash } from 'node:crypto';
import { computeAiExtractHash } from '../../src/moments/ai-extract-hash.js';

describe('computeAiExtractHash（spec people-place §5 幂等判据）', () => {
  it('sha256(content + "\\0" + transcript)，64 位小写十六进制', () => {
    expect(computeAiExtractHash('外婆家', '朵朵笑了')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('与手工 sha256 逐字一致（钉死公式，防实现漂移）', () => {
    const manual = createHash('sha256').update('正文\0转写').digest('hex');
    expect(computeAiExtractHash('正文', '转写')).toBe(manual);
  });

  it('确定性：同输入同 hash；内容或转写任一变化 → hash 变化', () => {
    const base = computeAiExtractHash('正文', '转写');
    expect(computeAiExtractHash('正文', '转写')).toBe(base);
    expect(computeAiExtractHash('正文改', '转写')).not.toBe(base);
    expect(computeAiExtractHash('正文', '转写改')).not.toBe(base);
    expect(computeAiExtractHash('正文改', '转写改')).not.toBe(base);
  });

  it('分隔符语义：content 与 transcript 边界变化可区分', () => {
    // 'a' + '\0' + 'bc' ≠ 'ab' + '\0' + 'c' —— \0 分隔符保证拼接无歧义
    expect(computeAiExtractHash('a', 'bc')).not.toBe(computeAiExtractHash('ab', 'c'));
  });

  it('transcript null 与空串产生相同 hash（偏差 7：素材语义相同）', () => {
    expect(computeAiExtractHash('正文', null)).toBe(computeAiExtractHash('正文', ''));
  });
});
