import { z } from 'zod';
import type { AggregateResponse, TemplateManifest } from './templates.js';
import type { MomentResponse } from './moments.js';

/** owner 创建分享链接：expiresAt 缺省 = 永不过期（spec §1：可设过期） */
export const createShareLinkInputSchema = z.object({
  expiresAt: z.string().datetime().optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;

/** 匿名公开页游标分页（固定 happened_at 排序，游标格式与 feed 一致，CONVENTIONS §3.4） */
export const publicShareQuerySchema = z.object({
  // Phase 4 游标边界约定（Phase 5/8 复用同一约定）：空串与 >1024 属 schema 校验错 → 400 VALIDATION_ERROR
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PublicShareQuery = z.infer<typeof publicShareQuerySchema>;

export interface ShareLinkDto {
  id: string;
  chainId: string;
  /** 明文 token（与 chain_invites.token 同策略；分享 URL 由客户端拼 /share/:token） */
  token: string;
  /** ISO 8601，null = 永不过期 */
  expiresAt: string | null;
  /** ISO 8601，null = 未吊销 */
  revokedAt: string | null;
  createdAt: string;
}

export interface ShareLinkListResponse {
  items: ShareLinkDto[];
}

export interface PublicShareChainInfo {
  name: string;
  description: string | null;
}

/** 匿名只读视图：计数只读展示（commentCount/reactions），myReaction 恒 null */
export interface PublicShareResponse {
  chain: PublicShareChainInfo;
  /** 链模板 key 与内嵌 manifest（spec §3.2：长辈可见里程碑轴/地图，渲染需要 manifest） */
  template: string;
  templateManifest: TemplateManifest;
  /** 该链模板声明的全部聚合投影（timeline 除外，由 moments 列表分章） */
  aggregates: AggregateResponse[];
  moments: MomentResponse[];
  nextCursor: string | null;
}
