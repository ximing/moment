import { Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/ui/Button';

const TYPE_LABEL: Record<string, string> = {
  'moment.created': '新时刻',
  'comment.created': '新评论',
  'reaction.created': '新表情',
  'invite.created': '新邀请',
};

function payloadTitle(payload: Record<string, unknown>): string {
  for (const key of ['title', 'momentContent', 'content', 'chainName']) {
    const v = payload[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function hrefOf(payload: Record<string, unknown>): string | null {
  const momentId = payload.momentId;
  const chainId = payload.chainId;
  if (typeof momentId === 'string') return `/moments/${momentId}`;
  if (typeof chainId === 'string') return `/chains/${chainId}`;
  return null;
}

export function NotificationsHome() {
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: qk.notifications(false),
    queryFn: ({ pageParam }) => client.listNotifications(undefined, { cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.notifications) ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markAll = useMutation({
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
  const unread = items.filter((n) => n.readAt === null).length;

  return (
    <div>
      <div className="mb-6 flex items-center">
        <h1 className="font-display text-2xl">通知</h1>
        {unread > 0 && (
          <Button variant="ghost" className="ml-auto" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
            全部标为已读
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((n) => {
          const href = hrefOf(n.payload);
          const inner = (
            <>
              <span className="text-muted">{TYPE_LABEL[n.type] ?? n.type}</span>
              <span className="ml-2">{payloadTitle(n.payload)}</span>
              {n.readAt === null && <span className="ml-2 text-xs text-accent">未读</span>}
            </>
          );
          return (
            <li key={n.id} className={`rounded-paper px-3 py-2 text-sm ${n.readAt ? '' : 'bg-white/60'}`}>
              {href ? <Link to={href}>{inner}</Link> : inner}
            </li>
          );
        })}
      </ul>
      {q.hasNextPage && (
        <button type="button" className="mt-4 text-sm text-muted" onClick={() => void q.fetchNextPage()}>
          更早
        </button>
      )}
    </div>
  );
}
