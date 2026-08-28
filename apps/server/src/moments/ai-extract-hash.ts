import { createHash } from 'node:crypto';

/**
 * AI 抽取幂等判据（spec people-place §5）：sha256(content + '\0' + transcript)。
 * 唯一实现——发射侧（moment.service create/update、transcribe 回填补发射）与消费侧
 * （handleMomentExtract 判据与写回）、回填 sweep 的语义判据全部同源 import，严禁复制公式。
 *
 * transcript 为 null 时按空串参与拼接（分隔符保留）：未转写与「转写成功但文本为空」
 * （笑声/环境音，transcript 存空串）产生同 hash——两者素材语义相同（无可抽内容），
 * 幂等判据一致是正确行为（见计划偏差 7）。
 */
export function computeAiExtractHash(content: string, transcript: string | null): string {
  return createHash('sha256').update(`${content}\0${transcript ?? ''}`).digest('hex');
}
