import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
// 必须显式指向 barrel 文件：src/ui/ 下同名遗留文件（Button.tsx / Banner.tsx）
// 在本 Task 删除前，大小写不敏感文件系统上裸目录导入会被截获。
import { Banner } from '@/ui/feedback/index';
import { Button } from '@/ui/button/index';
import { InviteService } from './invite.service';

const InvitePageContent = observer(function InvitePageContent() {
  const { token } = useParams<{ token: string }>();
  const service = useService(InviteService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  // 接受中态用本地 state：jsdom 下 RAB 属性变更不触发 observer 重渲（见
  // settings-account.test.tsx 约定），loading 必须可从 DOM 断言；请求仍只走 service.accept。
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: token ? `/invites/${token}` : undefined }} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-surface-lg bg-surface p-8 text-center">
        {/* 「加入」不在得意黑字形子集内，标题不用 font-display */}
        <h1 className="text-xl font-medium">加入时光链</h1>
        <p className="mt-2 text-sm text-muted">和家人一起记下这一家的时刻。</p>
        {service.$model.accept.error && (
          <div className="mt-4">
            <Banner tone="error">{humanError(service.$model.accept.error)}</Banner>
          </div>
        )}
        <Button
          className="mt-6 w-full"
          loading={accepting}
          onClick={() => {
            if (accepting) return;
            setAccepting(true);
            void service
              .accept()
              .then((chainId) => navigate(`/chains/${chainId}`, { replace: true }))
              .catch(() => undefined) // API 错误横幅读 $model.accept.error
              .finally(() => setAccepting(false));
          }}
        >
          {accepting ? '加入中…' : '接受邀请'}
        </Button>
      </div>
    </div>
  );
});

export const InvitePage = bindServices(InvitePageContent, [InviteService]);
