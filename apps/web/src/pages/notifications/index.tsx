import { Link } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { NotificationService } from '@/services/notification.service';
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

export const NotificationsHome = observer(function NotificationsHome() {
  const notification = useService(NotificationService);
  const items = notification.items;
  const unread = notification.unreadCount;

  return (
    <div className="max-w-content">
      <div className="mb-6 flex items-center">
        <h1 className="text-2xl font-medium">通知</h1>
        {unread > 0 && (
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={notification.$model.markAllRead.loading}
            onClick={() => void notification.markAllRead()}
          >
            全部标为已读
          </Button>
        )}
      </div>
      {items.length === 0 && !notification.$model.loadFirst.loading && (
        <p className="py-16 text-center text-muted">还没有新消息。记下一条，家里人就会在这儿看见。</p>
      )}
      <ul className="space-y-2">
        {items.map((n) => {
          const href = hrefOf(n.payload);
          const inner = (
            <>
              {n.readAt === null && <span className="h-2 w-2 shrink-0 rounded-full bg-action" aria-label="未读" />}
              <span className="text-muted">{TYPE_LABEL[n.type] ?? n.type}</span>
              <span className="ml-2">{payloadTitle(n.payload)}</span>
            </>
          );
          return (
            <li key={n.id} className="rounded-card bg-surface p-3 text-sm shadow-sticker">
              {href ? (
                <Link to={href} className="flex items-center gap-2">
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center gap-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {notification.hasMore && (
        <button type="button" className="mt-4 text-sm text-muted" onClick={() => void notification.loadMore()}>
          更早
        </button>
      )}
    </div>
  );
});
