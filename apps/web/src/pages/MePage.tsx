import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { MAX_IMAGE_BYTES } from '@moment/dto';
import { client } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import { compressImage } from '@/lib/compress';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { ThemeToggle } from '@/ui/ThemeToggle';

export function MePage() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_IMAGE_BYTES) throw new Error('图片太大了');
      const compressed = await compressImage(file);
      const res = await client.uploadMedia({
        file: compressed,
        mime: compressed.type,
        size: compressed.size,
        kind: 'image',
      });
      return client.updateMe({ avatarMediaId: res.mediaId });
    },
    onSuccess: (next) => {
      refreshUser(next);
      setPreview(null);
      setError(null);
    },
    onError: (e) => setError(humanError(e)),
  });

  const clear = useMutation({
    mutationFn: () => client.updateMe({ avatarMediaId: null }),
    onSuccess: (next) => {
      refreshUser(next);
      setPreview(null);
    },
    onError: (e) => setError(humanError(e)),
  });

  if (!user) return null;
  const shown = preview ?? user.avatarUrl;

  return (
    <div className="max-w-content">
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded-full hover:opacity-90"
          onClick={() => fileRef.current?.click()}
          aria-label="换头像"
        >
          <Avatar name={user.nickname} color={user.avatarColor} icon={user.avatarIcon} src={shown} size={72} />
        </button>
        <div>
          <h1 className="text-2xl font-medium">{user.nickname}</h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm text-muted">头像</h2>
        <div className="mt-2 rounded-card bg-surface p-4 elev">
          <p className="text-sm text-muted">点头像或按钮上传一张图。和时刻里的照片一样，存在私有桶里，打开资料时签发 6 天链接。</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setPreview(URL.createObjectURL(file));
              upload.mutate(file);
            }}
          />
          {error && (
            <div className="mt-3">
              <Banner>{error}</Banner>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              {upload.isPending ? '上传中…' : '上传头像'}
            </Button>
            {user.avatarUrl && (
              <Button variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
                去掉头像
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm text-muted">主题</h2>
        <div className="mt-2 rounded-card bg-surface p-4 elev">
          <ThemeToggle />
        </div>
      </section>

      <button
        type="button"
        className="mt-8 rounded-lg px-2 py-1 text-sm text-muted hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"
        onClick={async () => {
          await logout();
          navigate('/login');
        }}
      >
        退出
      </button>
    </div>
  );
}
