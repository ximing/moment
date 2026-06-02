import { randomBytes, randomUUID } from 'node:crypto';
import type { CreateShareLinkInput, ShareLinkDto, ShareLinkListResponse } from '@moment/dto';
import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { shareLinks, type ShareLink } from '../db/schema.js';

function toDto(row: ShareLink): ShareLinkDto {
  return {
    id: row.id,
    chainId: row.chainId,
    token: row.token,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Service()
export class ShareLinkService {
  constructor(private readonly policy: ChainPolicy) {}

  /**
   * 创建（owner 鉴权在 requireChainRole 中间件完成，CONVENTIONS §3.1：controller 内禁止手写角色判断）。
   * 直接返回内存行是安全的：Task 2 三个 timestamp 列为 fsp:3，与 JS Date 毫秒精度一致，
   * create 的 201 响应与后续 list 回查响应精度自洽（无需回查或截断）。
   */
  async create(userId: string, chainId: string, input: CreateShareLinkInput): Promise<ShareLinkDto> {
    const row: ShareLink = {
      id: randomUUID(),
      chainId,
      token: randomBytes(32).toString('hex'), // 64 字符不可猜测（spec §6）
      createdBy: userId,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      revokedAt: null,
      createdAt: new Date(),
    };
    await db.insert(shareLinks).values(row);
    return toDto(row);
  }

  /** owner 管理视图：含已吊销（可审计），createdAt 倒序 */
  async list(chainId: string): Promise<ShareLinkListResponse> {
    const rows = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.chainId, chainId))
      .orderBy(desc(shareLinks.createdAt));
    return { items: rows.map(toDto) };
  }

  /** 吊销（幂等）：资源 id 反查链 → ChainPolicy（非成员 404 CHAIN_NOT_FOUND、非 owner 403 CHAIN_ROLE_INSUFFICIENT） */
  async revoke(userId: string, shareLinkId: string): Promise<void> {
    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, shareLinkId)).limit(1);
    if (!row) throw new NotFoundError('SHARE_LINK_NOT_FOUND');
    await this.policy.require(userId, row.chainId, 'owner');
    if (row.revokedAt) return; // 幂等
    await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, row.id));
  }

  /** 有效 = 存在 + 未吊销 + 未过期；无效一律 null（匿名路径统一 404，不区分原因） */
  async findValidByToken(token: string): Promise<ShareLink | null> {
    const [row] = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1);
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  }
}
