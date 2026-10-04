import { Service } from "@rabjs/react";
import {
  MAX_IMAGE_BYTES,
  type AccessToken,
  type CreatedAccessToken,
} from "@moment/dto";
import { client } from "@/api/client";
import { compressImage } from "@/lib/compress";
import { AuthService } from "@/services/auth.service";

/** 资料页（spec §4.5）：头像上传/清除 + 接口令牌。上传成功走 auth.refreshUser。 */
export class MeService extends Service {
  preview: string | null = null;
  tokenName = "";
  tokens: AccessToken[] = [];
  /** 刚生成的完整令牌。关掉之后只剩 preview。 */
  issued: CreatedAccessToken | null = null;
  pendingRevoke: AccessToken | null = null;
  copied = false;
  copyError = "";

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async uploadAvatar(file: File): Promise<void> {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("图片太大了");
    const compressed = await compressImage(file);
    const res = await client.uploadMedia({
      file: compressed,
      mime: compressed.type,
      size: compressed.size,
      kind: "image",
    });
    const next = await client.updateMe({ avatarMediaId: res.mediaId });
    this.preview = null;
    this.auth.refreshUser(next);
  }

  async clearAvatar(): Promise<void> {
    const next = await client.updateMe({ avatarMediaId: null });
    this.preview = null;
    this.auth.refreshUser(next);
  }

  setPreview(url: string): void {
    this.preview = url;
  }

  async loadTokens(): Promise<void> {
    const res = await client.listAccessTokens();
    this.tokens = res.tokens;
  }

  async createToken(): Promise<void> {
    const name = this.tokenName.trim();
    if (!name) throw new Error("给令牌起个名字");
    const created = await client.createAccessToken({ name });
    this.tokenName = "";
    this.copied = false;
    this.copyError = "";
    this.issued = created;
    this.tokens = [
      created,
      ...this.tokens.filter((token) => token.id !== created.id),
    ];
  }

  dismissIssued(): void {
    this.issued = null;
    this.copied = false;
    this.copyError = "";
  }

  async copyIssued(): Promise<void> {
    if (!this.issued) return;
    try {
      await navigator.clipboard.writeText(this.issued.token);
      this.copied = true;
      this.copyError = "";
    } catch {
      this.copied = false;
      this.copyError = "复制失败，请手动选择令牌";
    }
  }

  askRevoke(token: AccessToken): void {
    this.pendingRevoke = token;
  }

  cancelRevoke(): void {
    this.pendingRevoke = null;
  }

  async revokeToken(): Promise<void> {
    const token = this.pendingRevoke;
    if (!token) return;
    await client.revokeAccessToken(token.id);
    this.tokens = this.tokens.filter((row) => row.id !== token.id);
    this.pendingRevoke = null;
  }
}
