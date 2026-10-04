import { Service } from "@rabjs/react";
import {
  MAX_IMAGE_BYTES,
  type AccessToken,
  type CreatedAccessToken,
} from "@moment/dto";
import { client } from "@/api/client";
import { compressImage } from "@/lib/compress";
import { AuthService } from "@/services/auth.service";

/** 帐户设置：头像、名字、修改密码、接口令牌。资料更新走 auth.refreshUser。 */
export class MeService extends Service {
  preview: string | null = null;
  nickname = "";
  /** 进个人资料页时从当前用户写入一次，避免覆盖正在输入的名字。 */
  nicknameReady = false;
  oldPassword = "";
  newPassword = "";
  confirmPassword = "";
  /** 改密成功后弹出说明，确认再退出当前会话。 */
  passwordDone = false;
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

  hydrateNickname(): void {
    if (this.nicknameReady) return;
    this.nickname = this.auth.user?.nickname ?? "";
    this.nicknameReady = true;
  }

  async saveNickname(): Promise<void> {
    const nickname = this.nickname.trim();
    if (!nickname || nickname.length > 50) throw new Error("名字需 1–50 字");
    const next = await client.updateMe({ nickname });
    this.nickname = next.nickname;
    this.auth.refreshUser(next);
  }

  async changePassword(): Promise<void> {
    const oldPassword = this.oldPassword;
    const newPassword = this.newPassword;
    if (!oldPassword) throw new Error("请输入旧密码");
    if (newPassword.length < 8 || newPassword.length > 72) {
      throw new Error("新密码需 8–72 位");
    }
    if (newPassword !== this.confirmPassword) {
      throw new Error("两次输入的新密码不一致");
    }
    await client.changePassword({ oldPassword, newPassword });
    this.oldPassword = "";
    this.newPassword = "";
    this.confirmPassword = "";
    this.passwordDone = true;
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
