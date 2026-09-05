import { Link } from 'react-router';
import { observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { NotificationService } from '@/services/notification.service';
import { Button } from '@/ui/button/index';
import { Banner, EmptyState, FeedSkeleton } from '@/ui/feedback/index';

// 通知页（plan Task 12）：已读 / 分页 / 标记行为不变；行是安静文字流（无卡片阴影），
// 未读点用行动色；行高吃 touch-control，类型 + 标题分行；加载 / 空 / 出错走结构化反馈基元。

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

function hrefOf(type: string, payload: Record<string, unknown>): string | null {
  const data = payload.data && typeof payload.data === 'object' ? (payload.data as Record<string, unknown>) : undefined;
  const inviteToken =
    typeof payload.inviteToken === 'string'
      ? payload.inviteToken
      : typeof data?.inviteToken === 'string'
        ? data.inviteToken
        : undefined;
  if (type === 'invite.created' && inviteToken) return `/invites/${inviteToken}`;
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
  const loadingFirst = notification.$model.loadFirst.loading;
  const loadError = notification.$model.loadFirst.error;

  return (
    <div className="max-w-content">
      <div className="mb-6 flex items-center">
        <h1 className="text-page-title font-semibold text-ink">通知</h1>
        {unread > 0 && (
          <Button
            variant="quiet"
            className="ml-auto"
            loading={notification.$model.markAllRead.loading}
            onClick={() => void notification.markAllRead().catch(() => undefined)}
          >
            全部标为已读
          </Button>
        )}
      </div>
      {items.length === 0 && loadingFirst && <FeedSkeleton />}
      {items.length === 0 && !loadingFirst && loadError && (
        <Banner
          tone="error"
          action={{ label: '重试', onPress: () => void notification.loadFirst().catch(() => undefined) }}
        >
          {humanError(loadError)}
        </Banner>
      )}
      {items.length === 0 && !loadingFirst && !loadError && (
        <EmptyState
          variant="plain"
          scope="page"
          title="还没有新消息"
          description="记下一条，家里人就会在这儿看见。"
        />
      )}
      <ul className="flex flex-col gap-2">
        {items.map((n) => {
          const href = hrefOf(n.type, n.payload);
          const title = payloadTitle(n.payload);
          const inner = (
            <>
              {n.readAt === null ? (
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-action" aria-label="未读" />
              ) : (
                <span className="mt-2 h-2 w-2 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-meta text-muted">{TYPE_LABEL[n.type] ?? n.type}</span>
                {title ? <span className="mt-1 block text-body text-ink">{title}</span> : null}
              </span>
            </>
          );
          const rowClass =
            'flex min-h-touch-control items-start gap-3 rounded-surface-md px-3 py-3 focus-visible:outline-none focus-visible:ring-focus';
          return (
            <li key={n.id}>
              {href ? (
                <Link to={href} className={`${rowClass} hover:bg-floating-hover`}>
                  {inner}
                </Link>
              ) : (
                <div className={rowClass}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {notification.hasMore && (
        <Button
          variant="quiet"
          className="mt-4"
          loading={notification.$model.loadMore.loading}
          onClick={() => void notification.loadMore().catch(() => undefined)}
        >
          更早
        </Button>
      )}
    </div>
  );
});
