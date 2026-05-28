import { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@moment/dto';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { formatRelative } from '../../src/lib/format';
import { Loading } from '../../src/components/Loading';

export default function NotificationsScreen() {
  // 服务端默认每页仅 20 条（Phase 6 依赖契约）：limit: 50 + onEndReached 消费 nextCursor
  const { data, isPending, refetch, isRefetching, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: qk.notifications(),
      queryFn: ({ pageParam }) => client.listNotifications(undefined, { cursor: pageParam, limit: 50 }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  const queryClient = useQueryClient();

  const onOpen = useCallback(
    (n: NotificationDto) => {
      const payload = n.payload as { data?: { momentId?: string } };
      if (n.readAt == null) {
        void client.markNotificationsRead([n.id]).then(() => {
          void queryClient.invalidateQueries({ queryKey: qk.notifications() });
        });
      }
      const momentId = payload.data?.momentId;
      if (momentId) router.push(`/moments/${momentId}`);
    },
    [queryClient, router]
  );

  if (isPending) return <Loading />;
  const items = data?.pages.flatMap((p) => p.notifications) ?? [];
  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={styles.list}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }}
      renderItem={({ item }) => {
        const payload = item.payload as { title?: string; body?: string };
        return (
          <Pressable style={[styles.item, item.readAt == null && styles.unread]} onPress={() => onOpen(item)}>
            <Text style={styles.title}>{payload.title ?? '时刻'}</Text>
            <Text style={styles.body}>{payload.body ?? ''}</Text>
            <Text style={styles.time}>{formatRelative(item.createdAt)}</Text>
          </Pressable>
        );
      }}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>暂无通知</Text></View>}
      ListFooterComponent={isFetchingNextPage ? <Text style={styles.loadingMore}>加载中…</Text> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  loadingMore: { textAlign: 'center', color: '#999', padding: 12 },
  item: { padding: 12, borderRadius: 8, backgroundColor: '#fff', marginBottom: 8 },
  unread: { backgroundColor: '#eef5ff' },
  title: { fontWeight: '600', fontSize: 15 },
  body: { color: '#444', fontSize: 14, marginTop: 2 },
  time: { color: '#999', fontSize: 12, marginTop: 4 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#999' },
});
