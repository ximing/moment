import { z } from 'zod';

export const chainVisibilitySchema = z.enum(['private', 'link', 'public']);
export type ChainVisibility = z.infer<typeof chainVisibilitySchema>;

export const chainRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ChainRole = z.infer<typeof chainRoleSchema>;

/** 邀请/改角色允许的目标角色——owner 只能通过 transfer 端点产生。 */
export const inviteRoleSchema = z.enum(['editor', 'viewer']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const createChainInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullish(),
  visibility: chainVisibilitySchema.default('private'),
});
export type CreateChainInput = z.infer<typeof createChainInputSchema>;

export const updateChainInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    visibility: chainVisibilitySchema.optional(),
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
  visibility: ChainVisibility;
  ownerId: string;
  /** 当前请求用户在该链中的角色；仅在「我参与的链」语境下返回 */
  myRole?: ChainRole;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface ChainMemberDto {
  userId: string;
  nickname: string;
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
