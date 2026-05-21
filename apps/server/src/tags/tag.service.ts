import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { TagCreateInput, TagListResponse, TagResponse } from '@moment/dto';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { momentTags, moments, tags, type Tag } from '../db/schema.js';

const MAX_TAGS_PER_CHAIN = 100;

@Service()
export class TagService {
  constructor(private policy: ChainPolicy) {}

  /** 一次 GROUP BY 取全部 tag + moment 数（软删 moment 不计入），禁止 N+1。 */
  async list(chainId: string): Promise<TagListResponse> {
    const rows = await db
      .select({
        id: tags.id,
        name: tags.name,
        createdAt: tags.createdAt,
        momentCount: sql<number>`count(${moments.id})`,
      })
      .from(tags)
      .leftJoin(momentTags, eq(momentTags.tagId, tags.id))
      .leftJoin(moments, and(eq(moments.id, momentTags.momentId), isNull(moments.deletedAt)))
      .where(eq(tags.chainId, chainId))
      .groupBy(tags.id)
      .orderBy(asc(tags.name));
    return {
      tags: rows.map((r) => ({
        id: r.id,
        name: r.name,
        momentCount: Number(r.momentCount),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async create(chainId: string, input: TagCreateInput): Promise<TagResponse> {
    // 权限由 controller 的 requireChainRole('editor') 保证，这里不再判断角色
    const [{ value: existing }] = await db
      .select({ value: count() })
      .from(tags)
      .where(eq(tags.chainId, chainId));
    if (Number(existing) >= MAX_TAGS_PER_CHAIN) {
      throw new HttpError(409, 'TAG_LIMIT_REACHED');
    }

    const [dup] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.chainId, chainId), eq(tags.name, input.name)))
      .limit(1);
    if (dup) throw new HttpError(409, 'TAG_EXISTS');

    const row: Tag = { id: randomUUID(), chainId, name: input.name, createdAt: new Date() };
    try {
      await db.insert(tags).values(row);
    } catch (err) {
      // 并发下唯一索引兜底：两个请求同时穿过前置检查
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'TAG_EXISTS');
      throw err;
    }
    return { id: row.id, name: row.name, momentCount: 0, createdAt: row.createdAt.toISOString() };
  }

  /**
   * DELETE /api/tags/:id 非嵌套路由：service 层反查链后走 ChainPolicy（CONVENTIONS §3.1）。
   * 注：tag 不存在 → TAG_NOT_FOUND，tag 存在但非成员 → CHAIN_NOT_FOUND，同为 404；探测者理论上
   * 可据此区分 tag 是否存在，泄露面极小，本计划显式声明该差异可接受，不归并。
   */
  async remove(tagId: string, userId: string): Promise<void> {
    const [tag] = await db.select().from(tags).where(eq(tags.id, tagId)).limit(1);
    if (!tag) throw new NotFoundError('TAG_NOT_FOUND');
    await this.policy.require(userId, tag.chainId, 'editor');

    await db.transaction(async (tx) => {
      // 硬删语义（spec §5.7）：先清 moment_tags 关联，再删 tag，一个事务
      await tx.delete(momentTags).where(eq(momentTags.tagId, tagId));
      await tx.delete(tags).where(eq(tags.id, tagId));
    });
  }
}
