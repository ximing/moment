import { Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { useState } from 'react';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => client.acceptInvite(token!),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: qk.chains });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      navigate(`/chains/${res.chainId}`, { replace: true });
    },
    onError: (e) => setError(humanError(e)),
  });

  if (!user) {
    return <Navigate to="/login" replace state={{ from: token ? `/invites/${token}` : undefined }} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display text-2xl">加入时光链</h1>
        <p className="mt-2 text-sm text-muted">和家人一起记下这一家的时刻。</p>
        {error && (
          <div className="mt-4">
            <Banner>{error}</Banner>
          </div>
        )}
        <Button className="mt-6 w-full" disabled={accept.isPending} onClick={() => accept.mutate()}>
          {accept.isPending ? '加入中…' : '接受邀请'}
        </Button>
      </div>
    </div>
  );
}
