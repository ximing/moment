import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { Icon } from '../../components/Icon';
import { FilterChips } from '../../components/FilterChips';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { TabHeader } from '../../components/TabHeader';
import { Banner, EmptyState } from '../../components/feedback';
import { ChainSelect } from './chain-select';
import { AuthService } from '../../services/auth.service';
import { ChainListService } from '../../services/chain-list.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { MemoriesEntryBar } from '../memories';
import { FeedService } from './feed.service';

const FeedContent = observer(function FeedContent() {
  const service = useService(FeedService);
  const auth = useService(AuthService);
  const chainList = useService(ChainListService);
  const myId = auth.user?.id; // 在 observer 渲染内取值，renderItem 闭包复用（禁解构 observable）
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const noChains = chainList.chains.length === 0 && !chainList.$model.load.loading;

  if (
    service.moments.length === 0 &&
    (service.$model.loadFirst.loading || chainList.$model.load.loading)
  ) {
    return <Loading />;
  }

  return (
    <View style={styles.flex}>
      <TabHeader>
        <ChainSelect
          chains={chainList.chains}
          chainId={service.chainId}
          order={service.order}
          onSelect={(id) => service.setChainFilter(id)}
          onToggleOrder={() => service.toggleOrder()}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索时刻"
          hitSlop={t.space2}
          onPress={() => router.push('/search')}
          style={styles.searchBtn}
        >
          <Icon name="search" size={t.fontInput} color={t.ink} />
        </Pressable>
      </TabHeader>
      {/* 那年今日入口条（spec memories-today §5）：筛选条之上，有内容才渲染 */}
      <MemoriesEntryBar />
      {service.chainId != null && service.tags.length > 0 ? (
        <View style={styles.filters}>
          <Chip label="全部标签" active={service.tagId == null} onPress={() => service.setTagFilter(undefined)} />
          {service.tags.map((tag) => (
            <Chip key={tag.id} label={`#${tag.name}`} active={service.tagId === tag.id} onPress={() => service.setTagFilter(tag.id)} />
          ))}
        </View>
      ) : null}
      <FilterChips
        personId={service.personId}
        personName={service.personName}
        place={service.place}
        onClearPerson={() => service.clearPersonFilter()}
        onClearPlace={() => service.clearPlaceFilter()}
      />
      {service.$model.loadFirst.error ? (
        <View style={styles.searchBanner}>
          <Banner tone="error">加载失败，下拉重试</Banner>
        </View>
      ) : null}
      <FlashList
        data={service.moments}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            tintColor={t.action}
            refreshing={service.$model.loadFirst.loading}
            onRefresh={() => void service.loadFirst().catch(() => undefined)}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void service.loadMore().catch(() => undefined)}
        renderItem={({ item }: { item: MomentResponse }) => (
          <MomentCard
            moment={item}
            onPress={() => router.push(`/moments/${item.id}`)}
            onLongPress={
              // spec §4.2：长按编辑/删除仅作者本人的卡片生效
              myId === item.author.id
                ? () =>
                    showMomentActions(item, () =>
                      router.push({ pathname: '/compose', params: { momentId: item.id } }),
                    )
                : undefined
            }
            onPersonFilter={(p) => service.togglePersonFilter(p)}
            onPlaceFilter={(place) => service.togglePlaceFilter(place)}
          />
        )}
        ListEmptyComponent={
          noChains ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="建第一条时光链，比如「宝宝成长」"
              description="到「我的链」开一条就可以。"
              action={{
                label: '开一条新的链',
                emphasis: 'primary',
                onPress: () => router.push('/chains-new'),
              }}
            />
          ) : service.personId || service.place || service.tagId || service.chainId ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="没有符合条件的时刻"
              description="换个标签或筛选再看看。"
              action={{ label: '清除筛选', emphasis: 'quiet', onPress: () => service.clearFilters() }}
            />
          ) : (
            <EmptyState
              variant="timeline"
              scope="section"
              title="还没有记下任何一刻"
              description="这一刻，等你来写下。"
              action={{
                label: '记下此刻',
                emphasis: 'primary',
                onPress: () => router.push('/compose'),
              }}
            />
          )
        }
        ListFooterComponent={service.$model.loadMore.loading ? <Text style={styles.loadingMore}>加载中…</Text> : null}
      />
      {noChains ? null : (
        <Link href={{ pathname: '/compose' }} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="记下此刻"
            style={styles.fab}
            onPress={() => undefined}
          >
            <Icon name="plus" size={t.space6} color={t.actionFg} />
          </Pressable>
        </Link>
      )}
    </View>
  );
});

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export const FeedPage = bindServices(FeedContent, [FeedService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    searchBtn: { width: t.touchMin, height: t.touchMin, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, paddingHorizontal: t.space3, paddingVertical: t.space1 },
    // 选中态对齐 SegmentBar：ink 色面 + bg 文字（中性、不抢 FAB 唯一实心高强调）
    chip: { paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.controlHProminent, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, flexShrink: 0 },
    chipActive: { backgroundColor: t.ink, borderColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.ink },
    chipTextActive: { color: t.bg },
    list: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space8 },
    searchBanner: { paddingHorizontal: t.space3, paddingVertical: t.space2 },
    loadingMore: { textAlign: 'center', color: t.muted, padding: t.space3 },
    fab: {
      position: 'absolute',
      right: t.space5,
      bottom: t.space6,
      width: t.controlHProminent + t.space3,
      height: t.controlHProminent + t.space3,
      borderRadius: (t.controlHProminent + t.space3) / 2,
      backgroundColor: t.action,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: t.space1,
    },
  });
