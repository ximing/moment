import { ACCESS_TOKEN_PREFIX } from "@moment/dto";
import {
  generateAccessToken,
  hashAccessToken,
  isPersonalAccessToken,
  previewAccessToken,
} from "../../src/auth/access-token-logic.js";

describe("access token 形状", () => {
  it("生成 mmt_ 令牌，哈希是 64 位十六进制，preview 露出首尾", () => {
    const token = generateAccessToken();
    expect(token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(isPersonalAccessToken(token)).toBe(true);
    expect(hashAccessToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(previewAccessToken(token)).toBe(
      `${token.slice(0, 8)}***${token.slice(-4)}`,
    );
    expect(isPersonalAccessToken("eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(
      false,
    );
    expect(isPersonalAccessToken(`${ACCESS_TOKEN_PREFIX}short`)).toBe(false);
    expect(generateAccessToken()).not.toBe(token);
  });
});
