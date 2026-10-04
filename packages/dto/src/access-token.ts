import { z } from "zod";

/** 设置里创建的接口令牌，给脚本和外部 Agent 用。前缀不与其他产品的令牌冲突。 */
export const ACCESS_TOKEN_PREFIX = "mmt_";
export const ACCESS_TOKEN_NAME_MAX = 64;
export const ACCESS_TOKEN_MAX_PER_USER = 20;

export const createAccessTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(ACCESS_TOKEN_NAME_MAX),
});
export type CreateAccessTokenInput = z.infer<
  typeof createAccessTokenInputSchema
>;

/** 列表行：只有缩略，没有完整令牌。 */
export const accessTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  preview: z.string(),
  /** ISO 8601 */
  createdAt: z.string(),
});
export type AccessToken = z.infer<typeof accessTokenSchema>;

/** 创建响应。`token` 只出现这一次，服务端只存哈希。 */
export const createdAccessTokenSchema = accessTokenSchema.extend({
  token: z.string().min(1),
});
export type CreatedAccessToken = z.infer<typeof createdAccessTokenSchema>;

export const accessTokenListSchema = z.object({
  tokens: z.array(accessTokenSchema),
});
export type AccessTokenList = z.infer<typeof accessTokenListSchema>;
