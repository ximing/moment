import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

export function TagsPanel({ chain }: { chain: ChainDto }) {
  const queryClient = useQueryClient();
  const canEdit = chain.myRole === 'owner' || chain.myRole === 'editor';
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: tagList } = useQuery({
    queryKey: qk.tags(chain.id),
    queryFn: () => client.listTags(chain.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.tags(chain.id) });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
  };

  const create = useMutation({
    mutationFn: () => client.createTag(chain.id, name.trim()),
    onSuccess: () => {
      setName('');
      setError(null);
      invalidate();
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '创建失败'),
  });
  const remove = useMutation({
    mutationFn: (tagId: string) => client.deleteTag(tagId),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '删除失败'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setError('标签名不能为空');
      return;
    }
    create.mutate();
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {canEdit && (
        <form onSubmit={onSubmit} className="flex gap-2 rounded-lg border border-gray-200 bg-white p-3" noValidate>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="新标签（链内唯一，1–50 字）"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button type="submit" disabled={create.isPending} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            添加
          </button>
        </form>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
        {(tagList?.tags ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 px-4 py-2.5">
            <span>#{t.name}</span>
            <span className="text-xs text-gray-400">{t.momentCount} 条时刻</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => remove.mutate(t.id)}
                className="ml-auto rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            )}
          </li>
        ))}
        {(tagList?.tags ?? []).length === 0 && <li className="px-4 py-3 text-gray-400">暂无标签</li>}
      </ul>
    </div>
  );
}
