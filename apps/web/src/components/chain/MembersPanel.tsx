import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';

export function MembersPanel({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = chain.myRole === 'owner';
  const [error, setError] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState('');
  const { data: members } = useQuery({
    queryKey: qk.chainMembers(chain.id),
    queryFn: () => client.listMembers(chain.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.chainMembers(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chain(chain.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chains });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : '操作失败');

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: 'editor' | 'viewer' }) =>
      client.updateMemberRole(chain.id, v.userId, v.role),
    onSuccess: invalidate,
    onError,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => client.removeMember(chain.id, userId),
    onSuccess: invalidate,
    onError,
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => client.transferChain(chain.id, userId),
    onSuccess: () => {
      setTransferTarget('');
      invalidate();
    },
    onError,
  });

  const nonOwnerMembers = (members ?? []).filter((m) => m.role !== 'owner');

  return (
    <div className="space-y-3">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {(members ?? []).map((m) => (
          <li key={m.userId} className="flex items-center gap-2 px-4 py-3 text-sm">
            <span className="font-medium">{m.nickname}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{m.role}</span>
            <span className="ml-auto text-xs text-gray-400">{m.joinedAt.slice(0, 10)} 加入</span>
            {isOwner && m.role !== 'owner' && (
              <select
                value={m.role}
                onChange={(e) =>
                  changeRole.mutate({ userId: m.userId, role: e.target.value as 'editor' | 'viewer' })
                }
                className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                aria-label={`修改 ${m.nickname} 的角色`}
              >
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            )}
            {isOwner && m.role !== 'owner' && (
              <button
                type="button"
                onClick={() => removeMember.mutate(m.userId)}
                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                移除
              </button>
            )}
            {!isOwner && m.userId === user?.id && (
              <button
                type="button"
                onClick={() => removeMember.mutate(m.userId)}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                退出此链
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <span>转让创建者给</span>
          <select
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="">选择成员…</option>
            {nonOwnerMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.nickname}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!transferTarget || transfer.isPending}
            onClick={() => transfer.mutate(transferTarget)}
            className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
          >
            转让
          </button>
        </div>
      )}
    </div>
  );
}
