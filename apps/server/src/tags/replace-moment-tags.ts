import { and, eq, inArray } from 'drizzle-orm';
import { BadRequestError } from 'routing-controllers';
import { momentTags, tags } from '../db/schema.js';
import type { DbTx } from '../outbox/outbox.js';

/**
 * 在调用方业务事务内全量重建 moment_tags（先删后插）。
 * 校验所有 tag 均属于 chainId，否则抛 TAG_NOT_IN_CHAIN，由事务回滚整笔操作。
 */
export async function replaceMomentTags(
  tx: DbTx,
  momentId: string,
  chainId: string,
  tagIds: string[],
): Promise<void> {
  await tx.delete(momentTags).where(eq(momentTags.momentId, momentId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;

  const found = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(inArray(tags.id, unique), eq(tags.chainId, chainId)));
  if (found.length !== unique.length) {
    throw new BadRequestError('TAG_NOT_IN_CHAIN');
  }

  await tx.insert(momentTags).values(unique.map((tagId) => ({ momentId, tagId })));
}
