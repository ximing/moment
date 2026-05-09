import { z } from 'zod';

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

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** access token 有效期（秒） */
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  /** ISO 8601 */
  createdAt: string;
}

export interface AuthResponse {
  user: UserProfile;
  tokens: AuthTokens;
}
