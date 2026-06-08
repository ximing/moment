import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { InviteService } from './invite.service';

const InvitePageContent = observer(function InvitePageContent() {
  const { token } = useParams<{ token: string }>();
  const service = useService(InviteService);
  const auth = useService(AuthService);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) service.hydrate(token);
  }, [service, token]);

  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: token ? `/invites/${token}` : undefined }} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center shadow-card">
        {/* 「加入」不在得意黑字形子集内，标题不用 font-display */}
        <h1 className="text-xl font-medium">加入时光链</h1>
        <p className="mt-2 text-sm text-muted">和家人一起记下这一家的时刻。</p>
        {error && (
          <div className="mt-4">
            <Banner>{error}</Banner>
          </div>
        )}
        {service.$model.accept.error && (
          <div className="mt-4">
            <Banner>{humanError(service.$model.accept.error)}</Banner>
          </div>
        )}
        <Button
          className="mt-6 w-full"
          disabled={service.$model.accept.loading}
          onClick={() =>
            void service
              .accept()
              .then((chainId) => navigate(`/chains/${chainId}`, { replace: true }))
              .catch((e) => setError(humanError(e)))
          }
        >
          {service.$model.accept.loading ? '加入中…' : '接受邀请'}
        </Button>
      </div>
    </div>
  );
});

export const InvitePage = bindServices(InvitePageContent, [InviteService]);
