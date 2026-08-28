import { eq } from 'drizzle-orm';
import { db, pool } from '../../src/db/index.js';
import {
  chainInvites,
  chainMembers,
  chains,
  comments,
  media,
  momentPersons,
  momentTags,
  moments,
  notifications,
  outbox,
  persons,
  pushTokens,
  reactions,
  recaps,
  refreshTokens,
  shareLinks,
  tags,
  templates,
  users,
} from '../../src/db/schema.js';

/**
 * 测试库是远程 MySQL（非 localhost），连接可能被网络瞬时重置（read ECONNRESET 等）。
 * 仅对连接级错误做有限重试（小退避）；业务/语法类错误立即抛出，不掩盖真实失败。
 */
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT']);

function isRetryableConnError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof e?.code === 'string' ? e.code : typeof e?.cause?.code === 'string' ? e.cause.code : undefined;
  return code !== undefined && RETRYABLE_CODES.has(code);
}

async function withConnRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableConnError(err) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

/** 每个用例前清表：先子表后父表（外键逆序）。仅允许对测试库使用。 */
export async function resetDb(): Promise<void> {
  // 清表语句幂等，整体重试安全：连接重置后重跑全序列即可。
  await withConnRetry(async () => {
    await db.delete(pushTokens);
    await db.delete(notifications);
    await db.delete(reactions);
    await db.delete(comments);
    await db.delete(momentTags);
    await db.delete(momentPersons);
    await db.delete(tags);
    await db.delete(persons);
    await db.delete(outbox);
    // chains→media 与 media→moments→chains 构成引用环：先显式断链再 delete(media)
    // （不能只靠调整 delete 顺序；ON DELETE SET NULL 虽能兜底，显式断开才不受 FK 行为约束）
    await db.update(chains).set({ avatarMediaId: null, coverMediaId: null });
    await db.delete(media);
    await db.delete(moments);
    await db.delete(chainInvites);
    await db.delete(chainMembers);
    await db.delete(shareLinks);
    await db.delete(recaps);
    await db.delete(chains);
    await db.delete(templates).where(eq(templates.scope, 'user'));
    await db.delete(refreshTokens);
    await db.delete(users);
  });
}

/** 测试文件收尾关闭连接池（不关闭 jest 进程会因 open handle 挂住不退出）。 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
