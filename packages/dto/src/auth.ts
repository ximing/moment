import { z } from 'zod';
import { chainColorSchema, chainIconSchema, type ChainColor, type ChainIcon } from './chains.js';

const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const registerInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(72),
  nickname: z.string().min(1).max(50),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export const changePasswordInputSchema = z.object({
  oldPassword: z.string().min(1).max(72),
  /** 与 register 密码规则一致 */
  newPassword: z.string().min(8).max(72),
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** access token 有效期（秒） */
  expiresIn: number;
}

/** 头像预签名 GET 有效期：6 天（S3 SigV4 IAM 上限 7 天）。每次下发用户资料时重新签发。 */
export const AVATAR_PRESIGN_TTL_SECONDS = 6 * 24 * 3600;

export const updateMeInputSchema = z
  .object({
    nickname: z.string().trim().min(1).max(50).optional(),
    avatarColor: chainColorSchema.nullable().optional(),
    avatarIcon: chainIconSchema.nullable().optional(),
    /** 已 complete 的图片 mediaId；null 清除头像 */
    avatarMediaId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'at least one field required',
  });
export type UpdateMeInput = z.infer<typeof updateMeInputSchema>;

export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  avatarColor: ChainColor | null;
  avatarIcon: ChainIcon | null;
  /** 私有桶预签名 GET；无头像为 null。每次接口重新签发，约 6 天有效 */
  avatarUrl: string | null;
  /** ISO 8601；无头像为 null */
  avatarExpiresAt: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface AuthResponse {
  user: UserProfile;
  tokens: AuthTokens;
}
