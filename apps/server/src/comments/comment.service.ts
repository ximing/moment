import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import type { CommentDto, CommentListResponse, CreateCommentInput } from '@moment/dto';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { comments, moments, users, type Comment, type Moment } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_COMMENT_CREATED } from '../outbox/types.js';
import { decodeCommentCursor, encodeCommentCursor } from './comment-cursor.js';

@Service()
export class CommentService {
  constructor(private readonly policy: ChainPolicy) {}

  /** 取可见且未软删的 moment：不存在/软删/无权限的错误语义集中在此（Phase 5 Global Constraints）。 */
  private async requireVisibleMoment(userId: string, momentId: string): Promise<Moment> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    return m;
  }

  /** 评论列表：moment 可见即可读（viewer+），升序旧→新，软删评论不出现。 */
  async list(
    userId: string,
    momentId: string,
    query: { cursor?: string; limit?: string }
  ): Promise<CommentListResponse> {
    await this.requireVisibleMoment(userId, momentId);

    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new HttpError(400, 'INVALID_LIMIT');
      }
    }

    const conditions: SQL[] = [eq(comments.momentId, momentId), isNull(comments.deletedAt)];
    if (query.cursor !== undefined && query.cursor !== '') {
      const cur = decodeCommentCursor(query.cursor);
      const after = new Date(cur.t);
      // (created_at, id) 严格晚于游标：时间更大，或时间相等但 id 更大
      conditions.push(
        or(gt(comments.createdAt, after), and(eq(comments.createdAt, after), gt(comments.id, cur.i))) as SQL,
      );
    }

    const rows = await db
      .select({ comment: comments, author: { id: users.id, nickname: users.nickname } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      comments: page.map((r) => this.toDto(r.comment, r.author)),
      nextCursor:
        hasMore && last
          ? encodeCommentCursor(last.comment.createdAt.getTime(), last.comment.id)
          : null,
    };
  }

  /** viewer+ 可评论（spec §1）。事务：插 comment + emitOutbox(comment.created)（spec §3）。 */
  async create(userId: string, momentId: string, input: CreateCommentInput): Promise<CommentDto> {
    const m = await this.requireVisibleMoment(userId, momentId);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(comments).values({ id, momentId, authorId: userId, content: input.content, createdAt: new Date() });
      await emitOutbox(tx, OUTBOX_COMMENT_CREATED, {
        commentId: id,
        momentId,
        chainId: m.chainId,
        authorId: userId,
      });
    });
    const [row] = await db
      .select({ comment: comments, author: { id: users.id, nickname: users.nickname } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.id, id))
      .limit(1);
    return this.toDto(row.comment, row.author);
  }

  /** 软删：评论作者本人或链 owner（spec §1 owner 可删链内任何内容）。幂等（已删再删 204）。 */
  async remove(userId: string, commentId: string): Promise<void> {
    const [c] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    if (!c) throw new NotFoundError('COMMENT_NOT_FOUND');
    const role = await this.policy.require(userId, (await this.momentChainId(c.momentId)), 'viewer');
    if (c.deletedAt) return;
    if (role !== 'owner' && c.authorId !== userId) {
      throw new HttpError(403, 'NOT_COMMENT_AUTHOR');
    }
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
  }

  private async momentChainId(momentId: string): Promise<string> {
    const [m] = await db.select({ chainId: moments.chainId }).from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    return m.chainId;
  }

  private toDto(c: Comment, author: { id: string; nickname: string }): CommentDto {
    return {
      id: c.id,
      momentId: c.momentId,
      author,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
