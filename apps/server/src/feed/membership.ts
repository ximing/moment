import { eq } from 'drizzle-orm';
import type { ChainRole } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { chainMembers } from '../db/schema.js';

/**
 * 请求入口一次性查出「我的 chain_id + role」集合（spec §5.1）。
 * feed 主查询只消费 chainId 列表，禁止 join chain_members。
 * （短 TTL 进程内缓存留待容量需要时加，YAGNI。）
 */
export async function getMyChains(userId: string): Promise<Map<string, ChainRole>> {
  const rows = await db
    .select({ chainId: chainMembers.chainId, role: chainMembers.role })
    .from(chainMembers)
    .where(eq(chainMembers.userId, userId));
  return new Map(rows.map((r) => [r.chainId, r.role as ChainRole]));
}
