/**
 * E2E fixture 图片资产（plan Task 14）：纯源码常量，无文件系统/网络读取。
 * 228 Base64 字符 → 169 字节，严格的 64×48 RGBA8 PNG，已验证字面量保持不变。
 */
export const FIXTURE_IMAGE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAAcElEQVR4AeXBURWAIADAwLlnFTtQgwoUILYxNAYfu7vePT8OWgxOkjiJkziJkziJkziJkziJkziJkziJkziJkziJkziJkziJk7ibhzSJkziJkziJkziJkziJkziJkziJkziJkziJkziJkziJkziJ+wE1twPHArzfWQAAAABJRU5ErkJggg==",
  "base64",
);
export const FIXTURE_IMAGE_MIME = "image/png" as const;
export const FIXTURE_IMAGE_WIDTH = 64;
export const FIXTURE_IMAGE_HEIGHT = 48;
/** adapter 相对 key（不含 prefix）：chains/{chainId}/{momentId}/{mediaId}.png */
export const FIXTURE_IMAGE_STORAGE_KEY =
  "chains/00000000-0000-4000-8000-000000000014/00000000-0000-4000-8000-000000000016/00000000-0000-4000-8000-000000000017.png" as const;
