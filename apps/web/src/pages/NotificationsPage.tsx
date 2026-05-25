import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';

const TYPE_LABEL: Record<string, string> = {
  'moment.created': '新时刻',
  'comment.created': '新评论',
  'reaction.created': '新表情',
  'invite.created': '新邀请',
};
function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
/** payload 是通知快照（spec §3：含资源标题快照），字段按 type 而异，防御性取 title/momentContent/chainName。 */
function payloadTitle(payload: Record<string, unknown>): string {
  for (const key of ['title', 'momentContent', 'content', 'chainName']) {
    const v = payload[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  // 服务端默认每页仅 20 条：limit: 50 + 「加载更多」消费 nextCursor（依赖契约段）
  const {
    data,
    isPending,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: qk.notifications(false),
    queryFn: ({ pageParam }) => client.listNotifications(undefined, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const items = data?.pages.flatMap((p) => p.notifications) ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markOne = useMutation({
    mutationFn: (id: string) => client.markNotificationsRead([id]),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    // Phase 5 schema 要求 ids 必填 1–100 个 uuid（无「空 = 全部已读」语义），且服务端每页最多 50 条：
    // 先循环翻页（limit=50 逐页取 nextCursor）收集**全部**未读 id——只读已加载页会漏掉未加载分页里的未读，
    // badge 清不零——再分批（每批 ≤100）串行提交。
    mutationFn: async () => {
      const unreadIds: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listNotifications(undefined, { cursor, limit: 50 });
        unreadIds.push(...page.notifications.filter((n) => n.readAt === null).map((n) => n.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      for (let i = 0; i < unreadIds.length; i += 100) {
        await client.markNotificationsRead(unreadIds.slice(i, i + 100));
      }
    },
    onSuccess: invalidate,
  });
  const unreadCount = items.filter((n) => n.readAt === null).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <h1 className="text-lg font-bold">通知</h1>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="ml-auto rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 disabled:opacity-50"
          >
            全部已读（{unreadCount}）
          </button>
        )}
      </div>
      {isPending && <p className="py-10 text-center text-gray-400">加载中…</p>}
      {isError && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error instanceof Error ? error.message : '未知错误'}
        </p>
      )}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {items.map((n: NotificationDto) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => n.readAt === null && markOne.mutate(n.id)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-gray-50"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${n.readAt === null ? 'bg-blue-500' : 'bg-transparent'}`} />
              <span className="font-medium">{typeLabel(n.type)}</span>
              <span className="flex-1 truncate text-gray-600">{payloadTitle(n.payload)}</span>
              <span className="shrink-0 text-xs text-gray-400">{n.createdAt.slice(0, 16).replace('T', ' ')}</span>
            </button>
          </li>
        ))}
        {!isPending && items.length === 0 && <li className="px-4 py-8 text-center text-gray-400">暂无通知</li>}
      </ul>
      {hasNextPage && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full rounded border border-gray-200 bg-white py-2 text-sm text-gray-500 disabled:opacity-50"
        >
          {isFetchingNextPage ? '加载中…' : '加载更多通知'}
        </button>
      )}
    </div>
  );
}
