import { z } from 'zod';
import type { TemplateManifest } from './templates.js';

export const chainVisibilitySchema = z.enum(['private', 'link', 'public']);
export type ChainVisibility = z.infer<typeof chainVisibilitySchema>;

export const chainRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ChainRole = z.infer<typeof chainRoleSchema>;

/** 邀请/改角色允许的目标角色——owner 只能通过 transfer 端点产生。 */
export const inviteRoleSchema = z.enum(['editor', 'viewer']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

/** 链标记默认色板；未设置时客户端按 chainId 哈希回退。 */
export const CHAIN_COLORS = ['coral', 'orange', 'pink', 'mint', 'sky', 'purple', 'cocoa', 'gold'] as const;
export const chainColorSchema = z.enum(CHAIN_COLORS);
export type ChainColor = z.infer<typeof chainColorSchema>;

/** 链标记预设图标；null = 只用色点。 */
export const CHAIN_ICONS = ['🌱', '👶', '✈️', '🏠', '💛', '📷', '🐾', '🎓', '🎵', '⭐'] as const;
export const chainIconSchema = z.enum(CHAIN_ICONS);
export type ChainIcon = z.infer<typeof chainIconSchema>;

export const createChainInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullish(),
  visibility: chainVisibilitySchema.default('private'),
  color: chainColorSchema.optional(),
  icon: chainIconSchema.nullish(),
  /** 链模板 key（spec §3.2：创建必传、不可改）；official 为 baby/travel/daily，user 模板为 u_<21位> */
  template: z.string().min(1).max(64),
  /** 链级模板数据（宝宝生日、行程列表等），按模板 manifest 的 chainPayloadSchema 在 server 校验 */
  payload: z.record(z.unknown()).nullish(),
});
export type CreateChainInput = z.infer<typeof createChainInputSchema>;

export const updateChainInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: chainVisibilitySchema.optional(),
    color: chainColorSchema.optional(),
    icon: chainIconSchema.nullable().optional(),
    // template 刻意不在此 schema：改 template 由 server controller 检测原始 body 抛 TEMPLATE_IMMUTABLE（spec §3.2）
    payload: z.record(z.unknown()).nullable().optional(),
    // coverMediaId 的校验依赖 media 归属判断，属 Phase 3，本阶段不支持改封面。
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one field required',
  });
export type UpdateChainInput = z.infer<typeof updateChainInputSchema>;

export const updateMemberRoleInputSchema = z.object({
  role: inviteRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>;

export const transferChainInputSchema = z.object({
  userId: z.string().min(1).max(36),
});
export type TransferChainInput = z.infer<typeof transferChainInputSchema>;

/**
 * 链排序提交（spec chain-ordering §5）：当前用户全部链 id 的新顺序。
 * server 校验「去重后恰好等于我的参与集合」；数组允许为空（无链用户的恒等提交），
 * 故不加 min(1)（加了反而对 0 条链的用户制造无谓 400）。
 */
export const reorderChainsInputSchema = z.object({
  chainIds: z.array(z.string().min(1).max(36)).max(200),
});
export type ReorderChainsInput = z.infer<typeof reorderChainsInputSchema>;

export const createInviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255).nullish(),
  role: inviteRoleSchema.default('editor'),
});
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;

export interface ChainDto {
  id: string;
  name: string;
  description: string | null;
  coverMediaId: string | null;
  /** 未选色时为 null，客户端按 id 哈希回退 */
  color: ChainColor | null;
  /** 未选图标时为 null，只画色点 */
  icon: ChainIcon | null;
  visibility: ChainVisibility;
  /** 链模板 key（创建时选定，不可改，spec §0） */
  template: string;
  /** 链级模板数据；未填为 null */
  payload: Record<string, unknown> | null;
  ownerId: string;
  /** 当前请求用户在该链中的角色；仅在「我参与的链」语境下返回 */
  myRole?: ChainRole;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** 成员预览：joinedAt 升序再 userId 升序，最多 5 人，含自己 */
  membersPreview: ChainMemberPreview[];
  /** 成员总数，含自己 */
  memberCount: number;
}

export interface ChainMemberPreview {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: ChainRole;
}

export interface ChainMemberDto {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: ChainRole;
  /** ISO 8601 */
  joinedAt: string;
}

export interface InviteDto {
  id: string;
  chainId: string;
  token: string;
  email: string | null;
  role: InviteRole;
  createdBy: string;
  /** ISO 8601 */
  expiresAt: string;
  /** ISO 8601，未接受为 null */
  acceptedAt: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface AcceptInviteResponse {
  chainId: string;
  role: ChainRole;
  /** true = 已是成员（幂等返回），未做任何写入 */
  alreadyMember: boolean;
}

/** 链详情 = ChainDto + 内嵌模板 manifest（spec §3.2：客户端不必二次请求模板） */
export interface ChainDetailDto extends ChainDto {
  templateManifest: TemplateManifest;
}
