import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import type { NotificationDto } from '@moment/dto';
import { NotificationService } from '../../services/notification.service';
import { formatRelative } from '../../lib/format';
import { Button } from '../../components/Button';
import { TabHeader } from '../../components/TabHeader';
import { EmptyState } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

const TYPE_LABEL: Record<string, string> = {
  'moment.created': '新时刻',
  'comment.created': '新评论',
  'reaction.created': '新表情',
  'invite.created': '新邀请',
};

/** payload 顶层优先（web 同款），嵌套 data 兜底（Phase 5 推送 payload 契约）。 */
function targetOf(n: NotificationDto): { momentId?: string; chainId?: string } {
  const p = n.payload as {
    momentId?: unknown;
    chainId?: unknown;
    data?: { momentId?: unknown; chainId?: unknown };
  };
  const momentId =
    typeof p.momentId === 'string' ? p.momentId : typeof p.data?.momentId === 'string' ? p.data.momentId : undefined;
  const chainId =
    typeof p.chainId === 'string' ? p.chainId : typeof p.data?.chainId === 'string' ? p.data.chainId : undefined;
  return { momentId, chainId };
}

function payloadTitle(n: NotificationDto): string {
  const p = n.payload as { title?: unknown; momentContent?: unknown; content?: unknown; chainName?: unknown };
  for (const key of ['title', 'momentContent', 'content', 'chainName'] as const) {
    const v = p[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return TYPE_LABEL[n.type] ?? '时刻';
}

export const NotificationsPage = observer(function NotificationsPage() {
  const service = useService(NotificationService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  function onOpen(n: NotificationDto): void {
    const { momentId, chainId } = targetOf(n);
    if (n.readAt == null) void service.markOneRead(n.id).catch(() => undefined);
    if (momentId) router.push(`/moments/${momentId}`);
    else if (chainId) router.push(`/chains/${chainId}`);
  }

  return (
    <View style={styles.flex}>
      <TabHeader>
        <View style={styles.headerGrow} />
        {service.unreadCount > 0 ? (
          <Button
            variant="quiet"
            loading={service.$model.markAllRead.loading}
            loadingText="标记中…"
            onPress={() => void service.markAllRead().catch(() => undefined)}
          >
            全部已读
          </Button>
        ) : null}
      </TabHeader>
      <FlashList
        data={service.items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            tintColor={t.action}
            refreshing={service.$model.loadFirst.loading}
            onRefresh={() => void service.loadFirst().catch(() => undefined)}
          />
        }
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={() => void service.loadMore().catch(() => undefined)}
        renderItem={({ item }) => {
          const p = item.payload as { body?: unknown };
          return (
            <Pressable style={[styles.item, item.readAt == null && styles.unread]} onPress={() => onOpen(item)}>
              <Text style={styles.title}>{payloadTitle(item)}</Text>
              <Text style={styles.body}>{typeof p.body === 'string' ? p.body : ''}</Text>
              <Text style={styles.time}>{formatRelative(item.createdAt)}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !service.$model.loadFirst.loading ? (
            <EmptyState
              variant="plain"
              scope="page"
              title="还没有新消息"
              description="记下一条，家里人就会在这儿看见。"
            />
          ) : null
        }
        ListFooterComponent={service.$model.loadMore.loading ? <Text style={styles.loadingMore}>加载中…</Text> : null}
      />
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    headerGrow: { flex: 1 },
    list: { padding: t.space3 },
    loadingMore: { textAlign: 'center', color: t.muted, padding: t.space3 },
    item: { padding: t.space3, borderRadius: t.radiusMd, backgroundColor: t.surface, marginBottom: t.space2 },
    unread: { backgroundColor: t.hoverSoft },
    title: { fontWeight: '600', fontSize: t.fontBody, color: t.ink },
    body: { color: t.ink, fontSize: t.fontLabel, marginTop: t.space1 },
    time: { color: t.muted, fontSize: t.fontCaption, marginTop: t.space1 },
  });
