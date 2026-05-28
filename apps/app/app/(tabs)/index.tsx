import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { MomentResponse } from '@moment/dto';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { Loading } from '../../src/components/Loading';
import { MomentCard } from '../../src/components/MomentCard';

const PAGE_SIZE = 20;

export default function FeedScreen() {
  const [chainId, setChainId] = useState<string | undefined>();
  const [tagId, setTagId] = useState<string | undefined>();
  const [order, setOrder] = useState<'happened_at' | 'created_at'>('happened_at');

  const filters = useMemo(() => ({ chainIds: chainId ? [chainId] : undefined, tagId, order }), [chainId, tagId, order]);

  const chains = useQuery({ queryKey: qk.chains(), queryFn: () => client.listChains() });
  const tags = useQuery({
    queryKey: qk.tags(chainId ?? ''),
    queryFn: () => client.listTags(chainId ?? ''),
    enabled: chainId != null,
  });

  const feed = useInfiniteQuery({
    queryKey: qk.feed(filters),
    queryFn: ({ pageParam }) =>
      client.getFeed({ cursor: pageParam, chainIds: filters.chainIds, tagId: filters.tagId, order: filters.order, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const moments = useMemo(() => feed.data?.pages.flatMap((p) => p.moments) ?? [], [feed.data]);

  if (feed.isPending) return <Loading />;

  return (
    <View style={styles.flex}>
      <View style={styles.filters}>
        <Chip label="全部链" active={chainId == null} onPress={() => { setChainId(undefined); setTagId(undefined); }} />
        {(chains.data ?? []).map((c) => (
          <Chip key={c.id} label={c.name} active={chainId === c.id} onPress={() => { setChainId(c.id); setTagId(undefined); }} />
        ))}
        <Chip
          label={order === 'happened_at' ? '按发生时间' : '按添加时间'}
          active={false}
          onPress={() => setOrder(order === 'happened_at' ? 'created_at' : 'happened_at')}
        />
      </View>
      {chainId != null && (tags.data?.tags.length ?? 0) > 0 ? (
        <View style={styles.filters}>
          <Chip label="全部标签" active={tagId == null} onPress={() => setTagId(undefined)} />
          {(tags.data?.tags ?? []).map((t) => (
            <Chip key={t.id} label={`#${t.name}`} active={tagId === t.id} onPress={() => setTagId(t.id)} />
          ))}
        </View>
      ) : null}
      {feed.isError ? <Text style={styles.errorBanner}>加载失败，下拉重试</Text> : null}
      <FlashList
        data={moments}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        renderItem={({ item }: { item: MomentResponse }) => (
          <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有时刻，发布第一条吧</Text>
          </View>
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? <Text style={styles.loadingMore}>加载中…</Text> : null
        }
      />
      <Link href={{ pathname: '/compose' }} asChild>
        <Pressable style={styles.fab} onPress={() => undefined}>
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e5e5' },
  chipActive: { backgroundColor: '#4a90d9', borderColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff' },
  list: { paddingBottom: 16 },
  empty: { padding: 48, alignItems: 'center' },
  emptyText: { color: '#999' },
  loadingMore: { textAlign: 'center', color: '#999', padding: 12 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4a90d9',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32 },
  errorBanner: { color: '#d33', textAlign: 'center', padding: 8 },
});
