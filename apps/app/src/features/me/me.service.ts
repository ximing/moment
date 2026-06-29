import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { client } from '../../lib/api';
import { compressImage, pickImages } from '../../lib/media';
import { AuthService } from '../../services/auth.service';

/** 「我」页：昵称草稿 + 头像上传/清除 + 修改密码。更新成功走 auth.refreshUser（由 Auth 发 auth:changed）。 */
export class MeService extends Service {
  nicknameDraft = '';
  oldPasswordDraft = '';
  newPasswordDraft = '';
  confirmPasswordDraft = '';

  /** 从 AuthService.user 水合昵称草稿（进入页面时组件调一次）。 */
  hydrateFromUser(): void {
    this.nicknameDraft = this.resolve(AuthService).user?.nickname ?? '';
  }

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async saveNickname(): Promise<void> {
    const nickname = this.nicknameDraft.trim();
    if (!nickname) throw new Error('昵称需 1–50 字');
    const next = await client.updateMe({ nickname });
    this.auth.refreshUser(next);
  }

  /** 单图 → 压缩 → uploadMedia → updateMe(avatarMediaId)。返回问题文案（null = 成功）。 */
  async pickAndUploadAvatar(): Promise<string | null> {
    const picked = await pickImages();
    if (picked.length === 0) return null;
    const compressed = await compressImage(picked[0]!);
    if (compressed.size > MAX_IMAGE_BYTES) return '图片太大了，换一张试试';
    const res = await client.uploadMedia({
      file: compressed.blob,
      mime: compressed.mime,
      size: compressed.size,
      kind: 'image',
    });
    const next = await client.updateMe({ avatarMediaId: res.mediaId });
    this.auth.refreshUser(next);
    return null;
  }

  async clearAvatar(): Promise<void> {
    const next = await client.updateMe({ avatarMediaId: null });
    this.auth.refreshUser(next);
  }

  /**
   * 修改密码。成功后服务端已全端下线（含当前会话），调用方负责提示并 auth.logout() 收敛本地态。
   * 本地校验抛 Error（文案直接展示）；服务端错误透传 ApiError 走 humanError。
   */
  async changePassword(): Promise<void> {
    const oldPassword = this.oldPasswordDraft;
    const newPassword = this.newPasswordDraft;
    if (!oldPassword) throw new Error('请输入旧密码');
    if (newPassword.length < 8 || newPassword.length > 72) throw new Error('新密码需 8–72 位');
    if (newPassword !== this.confirmPasswordDraft) throw new Error('两次输入的新密码不一致');
    await client.changePassword({ oldPassword, newPassword });
    this.oldPasswordDraft = '';
    this.newPasswordDraft = '';
    this.confirmPasswordDraft = '';
  }
}
