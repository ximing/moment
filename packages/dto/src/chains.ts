import { z } from 'zod';
import emojiRegex from 'emoji-regex';
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

/** 链标记预设图标（仅供客户端候选项展示）；null = 只用色点。 */
export const CHAIN_ICONS = ['🌱', '👶', '✈️', '🏠', '💛', '📷', '🐾', '🎓', '🎵', '⭐'] as const;

/** 链外观色：预设色或 #RRGGBB（统一为大写）。 */
export const chainAppearanceColorSchema = z.union([
  chainColorSchema,
  z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform((value) => value.toUpperCase() as `#${string}`),
]);
export type ChainAppearanceColor = z.infer<typeof chainAppearanceColorSchema>;

/** 单个完整 Unicode Emoji 序列，最多 64 个 UTF-16 code units。 */
export const chainIconSchema = z.string().min(1).max(64).refine((value) => {
  const matches = [...value.matchAll(emojiRegex())];
  return matches.length === 1 && matches[0]![0] === value;
}, 'exactly one emoji required');
export type ChainIcon = z.infer<typeof chainIconSchema>;

export const chainImageFocusSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export type ChainImageFocus = z.infer<typeof chainImageFocusSchema>;

const chainMediaIdSchema = z.string().uuid();

export const createChainInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).nullish(),
    visibility: chainVisibilitySchema.default('private'),
    color: chainAppearanceColorSchema.optional(),
    icon: chainIconSchema.nullish(),
    avatarMediaId: chainMediaIdSchema.nullish(),
    avatarFocus: chainImageFocusSchema.nullish(),
    coverMediaId: chainMediaIdSchema.nullish(),
    coverFocus: chainImageFocusSchema.nullish(),
    /** 链模板 key（spec §3.2：创建必传、不可改）；official 为 baby/travel/daily，user 模板为 u_<21位> */
    template: z.string().min(1).max(64),
    /** 链级模板数据（宝宝生日、行程列表等），按模板 manifest 的 chainPayloadSchema 在 server 校验 */
    payload: z.record(z.unknown()).nullish(),
  })
  .superRefine((value, ctx) => {
    const hasColorOrIcon = value.color != null || value.icon != null;
    if (value.avatarMediaId != null && hasColorOrIcon) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image appearance cannot be combined with color or icon' });
    }
    if (value.avatarFocus != null && value.avatarMediaId == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['avatarFocus'], message: 'avatarFocus requires avatarMediaId' });
    }
    if (value.coverFocus != null && value.coverMediaId == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coverFocus'], message: 'coverFocus requires coverMediaId' });
    }
  });
export type CreateChainInput = z.infer<typeof createChainInputSchema>;

export const updateChainInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: chainVisibilitySchema.optional(),
    color: chainAppearanceColorSchema.optional(),
    icon: chainIconSchema.nullable().optional(),
    avatarMediaId: chainMediaIdSchema.nullable().optional(),
    avatarFocus: chainImageFocusSchema.nullable().optional(),
    coverMediaId: chainMediaIdSchema.nullable().optional(),
    coverFocus: chainImageFocusSchema.nullable().optional(),
    // template 刻意不在此 schema：改 template 由 server controller 检测原始 body 抛 TEMPLATE_IMMUTABLE（spec §3.2）
    payload: z.record(z.unknown()).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasColorOrIcon = value.color != null || value.icon != null;
    if (value.avatarMediaId != null && hasColorOrIcon) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image appearance cannot be combined with color or icon' });
    }
    if (value.avatarMediaId === null && value.avatarFocus != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['avatarFocus'], message: 'avatarFocus cannot accompany null avatarMediaId' });
    }
    if (value.coverMediaId === null && value.coverFocus != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coverFocus'], message: 'coverFocus cannot accompany null coverMediaId' });
    }
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
  avatarMediaId: string | null;
  avatarUrl: string | null;
  avatarFocus: ChainImageFocus | null;
  coverMediaId: string | null;
  coverUrl: string | null;
  coverFocus: ChainImageFocus | null;
  /** 未选色时为 null，客户端按 id 哈希回退 */
  color: ChainAppearanceColor | null;
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
