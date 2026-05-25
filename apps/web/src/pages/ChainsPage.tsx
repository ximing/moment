import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Plus } from 'lucide-react';
import { ApiError } from '@moment/api-client';
import { createChainInputSchema, type ChainDto, type CreateChainInput } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

const ROLE_LABEL: Record<string, string> = { owner: '创建者', editor: '可记录', viewer: '只读' };

export function ChainsPage() {
  const queryClient = useQueryClient();
  const { data: chains, isPending, isError, error } = useQuery({
    queryKey: qk.chains,
    queryFn: () => client.listChains(),
  });

  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: CreateChainInput) => client.createChain(input),
    onSuccess: () => {
      setName('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: qk.chains });
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createChainInputSchema.safeParse({ name });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? '名称不合法');
      return;
    }
    setFieldError(null);
    try {
      await create.mutateAsync(parsed.data);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : '创建失败');
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2 rounded-lg border border-gray-200 bg-white p-3" noValidate>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新建时光链，如「宝宝成长」"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="flex items-center gap-1 rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          <Plus size={14} />
          创建
        </button>
      </form>
      {fieldError && <p className="text-xs text-red-600">{fieldError}</p>}
      {formError && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

      {isPending && <p className="py-10 text-center text-gray-400">加载中…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(chains ?? []).map((c: ChainDto) => (
          <Link
            key={c.id}
            to={`/chains/${c.id}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-400"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {c.myRole === 'owner' && <Crown size={14} className="text-amber-500" />}
              <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {ROLE_LABEL[c.myRole ?? 'viewer']}
              </span>
            </div>
            {c.description && <p className="mt-1 line-clamp-2 text-sm text-gray-500">{c.description}</p>}
            <p className="mt-2 text-xs text-gray-400">创建于 {c.createdAt.slice(0, 10)}</p>
          </Link>
        ))}
      </div>
      {!isPending && (chains ?? []).length === 0 && (
        <p className="py-10 text-center text-gray-400">还没有链。创建第一条，或等好友邀请你加入。</p>
      )}
    </div>
  );
}
