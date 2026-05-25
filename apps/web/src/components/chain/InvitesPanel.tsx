import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

export function InvitesPanel({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const canCreate = chain.myRole === 'owner' || chain.myRole === 'editor';
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: invites } = useQuery({
    queryKey: qk.chainInvites(chain.id),
    queryFn: () => client.listInvites(chain.id),
    enabled: chain.myRole === 'owner',
  });

  const create = useMutation({
    mutationFn: (input: { role: 'editor' | 'viewer'; email?: string }) =>
      client.createInvite(chain.id, input),
    onSuccess: () => {
      setEmail('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.chainInvites(chain.id) });
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '创建失败'),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => client.revokeInvite(inviteId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.chainInvites(chain.id) }),
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '吊销失败'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ role, email: email.trim() === '' ? undefined : email.trim() });
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/invites/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {canCreate && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <span>邀请新成员为</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
            className="rounded border border-gray-300 px-2 py-1"
          >
            <option value="editor">editor（可记录）</option>
            <option value="viewer">viewer（只读）</option>
          </select>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="绑定邮箱（可选，仅该邮箱可接受）"
            className="flex-1 rounded border border-gray-300 px-2 py-1"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
          >
            生成邀请
          </button>
        </form>
      )}
      {chain.myRole === 'owner' && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
          {(invites ?? []).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{i.role}</span>
              {i.email && <span className="text-gray-600">{i.email}</span>}
              <span className="text-xs text-gray-400">
                {i.acceptedAt ? `已接受（${i.acceptedAt.slice(0, 10)}）` : `${i.expiresAt.slice(0, 10)} 过期`}
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink(i.token)}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                >
                  {copied === i.token ? '已复制' : '复制链接'}
                </button>
                <button
                  type="button"
                  onClick={() => revoke.mutate(i.id)}
                  className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                >
                  吊销
                </button>
              </span>
            </li>
          ))}
          {(invites ?? []).length === 0 && <li className="px-4 py-3 text-gray-400">暂无邀请</li>}
        </ul>
      )}
      {!canCreate && (
        <p className="py-6 text-center text-sm text-gray-400">viewer 不能创建邀请，请找链内创建者或 editor。</p>
      )}
    </div>
  );
}
