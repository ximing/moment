import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@moment/api-client';
import { REACTION_EMOJIS, createCommentInputSchema, type MomentResponse } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { useAuth } from '@/auth/AuthProvider';
import { MomentCard } from '@/components/MomentCard';
import { formatHappenedAt } from '@/lib/time';

export function MomentDetailPage() {
  const { momentId } = useParams<{ momentId: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: moment, isPending, isError, error: queryError } = useQuery({
    queryKey: qk.moment(momentId ?? ''),
    queryFn: () => client.getMoment(momentId!),
    enabled: momentId !== undefined,
  });
  // 评论分页：服务端默认每页仅 20 条，limit: 50 + 「加载更多」消费 nextCursor
  const commentsQuery = useInfiniteQuery({
    queryKey: qk.comments(momentId ?? ''),
    queryFn: ({ pageParam }) =>
      client.listComments(momentId!, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: momentId !== undefined,
  });
  const comments = commentsQuery.data?.pages.flatMap((p) => p.comments) ?? [];

  /** reaction/评论变化后同步详情缓存与列表（feed/链时间线的计数经 invalidate 刷新） */
  const touchLists = (chainId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    void queryClient.invalidateQueries({ queryKey: qk.chainMoments(chainId) });
  };

  const react = useMutation({
    mutationFn: (v: { emoji?: string }) =>
      v.emoji ? client.setReaction(momentId!, v.emoji) : client.removeReaction(momentId!),
    // Phase 5：reaction PUT/DELETE 均 204 空 body，拿不到更新后的 MomentResponse——
    // invalidate 后重新 GET（myReaction/reactions/commentCount 随之刷新）。
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.moment(momentId!) });
      if (moment) touchLists(moment.chainId);
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '操作失败'),
  });

  const addComment = useMutation({
    mutationFn: (text: string) => client.createComment(momentId!, text),
    onSuccess: () => {
      setContent('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId!) });
      if (moment) {
        // 函数式更新：按缓存现值递增，不用闭包里的 moment 快照全量覆盖
        // （快照可能因 reaction 并发 invalidate 已过期，展开覆盖会回退其他字段）。
        queryClient.setQueryData<MomentResponse | undefined>(qk.moment(moment.id), (prev) =>
          prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev
        );
        touchLists(moment.chainId);
      }
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '评论失败'),
  });

  const removeComment = useMutation({
    mutationFn: (commentId: string) => client.deleteComment(commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.comments(momentId!) });
      if (moment) {
        // 同 addComment：函数式按缓存现值递减（不展开闭包快照）。
        queryClient.setQueryData<MomentResponse | undefined>(qk.moment(moment.id), (prev) =>
          prev ? { ...prev, commentCount: Math.max(0, prev.commentCount - 1) } : prev
        );
        touchLists(moment.chainId);
      }
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : '删除失败'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createCommentInputSchema.safeParse({ content });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '评论内容不合法');
      return;
    }
    await addComment.mutateAsync(parsed.data.content).catch(() => undefined);
  }

  if (isPending) return <p className="py-10 text-center text-gray-400">加载中…</p>;
  if (isError || !moment) {
    return (
      <div className="space-y-3">
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{queryError instanceof Error ? queryError.message : '不存在或无权访问'}（软删 moment 返回 410）
        </p>
        <Link to="/" className="text-sm text-gray-600 underline">回 feed</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MomentCard moment={moment} />

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          {REACTION_EMOJIS.map((emoji) => {
            const summary = moment.reactions.find((r) => r.emoji === emoji);
            const mine = moment.myReaction === emoji; // Phase 5：无 ReactionSummary.mine，用 MomentResponse.myReaction
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => (mine ? react.mutate({}) : react.mutate({ emoji }))}
                className={`rounded-full border px-2.5 py-1 text-sm ${
                  mine ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700'
                }`}
              >
                {emoji} {summary?.count ?? 0}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium">评论（{moment.commentCount}）</h2>
        {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <ul className="divide-y divide-gray-100">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2 py-2 text-sm">
              <span className="font-medium">{c.author.nickname}</span>
              <span className="flex-1 whitespace-pre-wrap">{c.content}</span>
              <span className="text-xs text-gray-400">{formatHappenedAt(c.createdAt, 0).slice(0, 16)}</span>
              {c.author.id === user?.id && (
                <button
                  type="button"
                  onClick={() => removeComment.mutate(c.id)}
                  className="text-xs text-red-500 hover:underline"
                >
                  删除
                </button>
              )}
            </li>
          ))}
          {comments.length === 0 && <li className="py-2 text-sm text-gray-400">还没有评论</li>}
        </ul>
        {commentsQuery.hasNextPage && (
          <button
            type="button"
            onClick={() => void commentsQuery.fetchNextPage()}
            disabled={commentsQuery.isFetchingNextPage}
            className="mt-2 w-full rounded border border-gray-200 py-1.5 text-xs text-gray-500 disabled:opacity-50"
          >
            {commentsQuery.isFetchingNextPage ? '加载中…' : '加载更多评论'}
          </button>
        )}
        <form onSubmit={onSubmit} className="mt-3 flex gap-2" noValidate>
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写评论…"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button
            type="submit"
            disabled={addComment.isPending}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
