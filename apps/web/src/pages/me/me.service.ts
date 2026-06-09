import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { client } from '@/api/client';
import { compressImage } from '@/lib/compress';
import { AuthService } from '@/services/auth.service';

/** 资料页（spec §4.5）：头像上传/清除 + 本地预览。上传成功走 auth.refreshUser。 */
export class MeService extends Service {
  preview: string | null = null;

  get auth(): AuthService {
    return this.resolve(AuthService);
  }

  async uploadAvatar(file: File): Promise<void> {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('图片太大了');
    const compressed = await compressImage(file);
    const res = await client.uploadMedia({
      file: compressed,
      mime: compressed.type,
      size: compressed.size,
      kind: 'image',
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
}
