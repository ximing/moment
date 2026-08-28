import { and, eq, inArray } from 'drizzle-orm';
import { BadRequestError } from 'routing-controllers';
import { momentPersons, persons } from '../db/schema.js';
import type { DbTx } from '../outbox/outbox.js';

/**
 * 在调用方业务事务内全量重建 moment_persons（先删后插，镜像 tags/replace-moment-tags.ts）。
 * - 校验所有 person 均属于 chainId，否则抛 PERSON_NOT_IN_CHAIN，由事务回滚整笔操作。
 * - 全量替换语义（spec §6 PATCH）：提交集合写 source（默认 manual），集合外原有行
 *   （manual 与 ai 一并）删除；ai 行被用户重选后经此路径升级 manual（spec §5 冲突规则）。
 * - 空数组 = 清空全部关联。
 * P4 的 AI「仅补缺」语义不得复用本函数（本函数删全集），需另写助手。
 */
export async function replaceMomentPersons(
  tx: DbTx,
  momentId: string,
  chainId: string,
  personIds: string[],
  source: 'manual' | 'ai' = 'manual',
): Promise<void> {
  await tx.delete(momentPersons).where(eq(momentPersons.momentId, momentId));
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return;

  const found = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(inArray(persons.id, unique), eq(persons.chainId, chainId)));
  if (found.length !== unique.length) {
    throw new BadRequestError('PERSON_NOT_IN_CHAIN');
  }

  await tx.insert(momentPersons).values(unique.map((personId) => ({ momentId, personId, source })));
}
