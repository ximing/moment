import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/button/index';
import { Banner } from '@/ui/feedback/index';
import { ThemeToggle } from '@/ui/ThemeToggle';
import { MeService } from './me.service';

// 「我」页（plan Task 12）：安静的内容堆叠，不再用 elev 卡片分区；头像上传/清除、
// 主题三态与退出语义不变。具名导出是测试 seam（同 MomentPageContent 先例）。
export const MePageContent = observer(function MePageContent() {
  const service = useService(MeService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  if (!auth.user) return null;
  const user = auth.user;
  const shown = service.preview ?? user.avatarUrl;
  const error = service.$model.uploadAvatar.error ?? service.$model.clearAvatar.error;

  return (
    <div className="max-w-content">
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="rounded-full hover:opacity-90 focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
          onClick={() => fileRef.current?.click()}
          aria-label="换头像"
        >
          <Avatar name={user.nickname} color={user.avatarColor} icon={user.avatarIcon} src={shown} size={72} />
        </button>
        <div>
          <h1 className="text-page-title font-semibold text-ink">{user.nickname}</h1>
          <p className="text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm text-muted">头像</h2>
        <p className="mt-2 text-sm text-muted">点头像或按钮上传一张图。和时刻里的照片一样，存在私有桶里，打开资料时签发 6 天链接。</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            service.setPreview(URL.createObjectURL(file));
            void service.uploadAvatar(file).catch(() => undefined);
          }}
        />
        {error && (
          <div className="mt-3">
            <Banner tone="error">{humanError(error)}</Banner>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button loading={service.$model.uploadAvatar.loading} onClick={() => fileRef.current?.click()}>
            上传头像
          </Button>
          {user.avatarUrl && (
            <Button
              variant="quiet"
              loading={service.$model.clearAvatar.loading}
              onClick={() => void service.clearAvatar().catch(() => undefined)}
            >
              去掉头像
            </Button>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm text-muted">主题</h2>
        <div className="mt-2">
          <ThemeToggle />
        </div>
      </section>

      <div className="mt-8">
        <Button variant="quiet" onClick={() => void auth.logout().then(() => navigate('/login'))}>
          退出
        </Button>
      </div>
    </div>
  );
});

export const MePage = bindServices(MePageContent, [MeService]);
