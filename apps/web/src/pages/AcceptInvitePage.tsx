import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

export function AcceptInvitePage() {
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
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '接受邀请失败'),
  });

  // 未登录：先去登录，带上回跳地址（LoginPage 的 state.from 逻辑，Task 4 已实现）
  if (!user) {
    return <Navigate to="/login" replace state={{ from: token ? `/invites/${token}` : undefined }} />;
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 text-center">
      <h1 className="mb-2 text-xl font-bold">加入时光链</h1>
      <p className="mb-6 text-sm text-gray-500">你被邀请加入一条时光链，与家人朋友共同记录时刻。</p>
      {error && <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={() => accept.mutate()}
        disabled={accept.isPending}
        className="w-full rounded bg-gray-900 py-2 text-white disabled:opacity-50"
      >
        {accept.isPending ? '加入中…' : '接受邀请'}
      </button>
    </div>
  );
}
