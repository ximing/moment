import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ApiError } from '@moment/api-client';
import type { MomentMedia, MomentResponse } from '@moment/dto';
import { client } from '@/api/client';

/** 媒体稳定入口 + share token 透传（spec §5.3）：m.url 是 /api/media/:id 相对路径（CONVENTIONS §3.4）。 */
function mediaSrc(m: MomentMedia, token: string): string {
  return `${m.url}?st=${encodeURIComponent(token)}`;
}

function ShareMomentCard({ moment, token }: { moment: MomentResponse; token: string }) {
  const happened = new Date(moment.happenedAt).toLocaleString();
  return (
    <article className="rounded-lg border bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">{moment.author.nickname}</span>
        <time className="shrink-0 text-xs text-gray-400">{happened}</time>
      </div>
      {moment.content && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{moment.content}</p>}
      {moment.media.length > 0 && (
        <div className={`mt-3 grid gap-1 ${moment.media.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
          {moment.media.map((md) =>
            md.mime.startsWith('video/') ? (
              <video key={md.id} src={mediaSrc(md, token)} controls preload="metadata" className="w-full rounded" />
            ) : (
              <img
                key={md.id}
                src={mediaSrc(md, token)}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded object-cover"
              />
            )
          )}
        </div>
      )}
      {/* 只读计数（计划决策：计数展示、无互动入口） */}
      {(moment.commentCount > 0 || moment.reactions.length > 0) && (
        <div className="mt-2 flex gap-3 text-xs text-gray-400">
          {moment.reactions.map((r) => (
            <span key={r.emoji}>
              {r.emoji} {r.count}
            </span>
          ))}
          {moment.commentCount > 0 && <span>{moment.commentCount} 条评论</span>}
        </div>
      )}
    </article>
  );
}

/** 匿名只读公开页（spec §1 链接分享）：不挂 RequireAuth，无任何互动/编辑入口。 */
export function SharePage() {
  const { token = '' } = useParams();
  const query = useInfiniteQuery({
    queryKey: ['public-share', token],
    queryFn: ({ pageParam }) => client.getPublicShare(token, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: token.length > 0,
    retry: false,
  });

  if (query.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-400">加载中…</p>
      </div>
    );
  }
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">{notFound ? '分享链接不存在或已失效' : '加载失败，请稍后重试'}</p>
      </div>
    );
  }

  const chain = query.data.pages[0]?.chain;
  const moments = query.data.pages.flatMap((p) => p.moments);
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <h1 className="text-lg font-semibold text-gray-900">{chain?.name}</h1>
          {chain?.description && <p className="mt-1 text-sm text-gray-500">{chain.description}</p>}
          <p className="mt-1 text-xs text-gray-400">只读分享 · 时刻 Moment</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">
        {moments.length === 0 && <p className="py-16 text-center text-sm text-gray-400">还没有内容</p>}
        <div className="space-y-3">
          {moments.map((m) => (
            <ShareMomentCard key={m.id} moment={m} token={token} />
          ))}
        </div>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="mt-4 w-full rounded border bg-white py-2 text-sm text-gray-600 disabled:opacity-50"
          >
            {query.isFetchingNextPage ? '加载中…' : '加载更多'}
          </button>
        )}
      </main>
    </div>
  );
}
