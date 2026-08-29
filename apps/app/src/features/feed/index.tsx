import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { FilterChips } from '../../components/FilterChips';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { MemoriesEntryBar } from '../memories';
import { FeedService } from './feed.service';

const FeedContent = observer(function FeedContent() {
  const service = useService(FeedService);
  const auth = useService(AuthService);
  const myId = auth.user?.id; // 在 observer 渲染内取值，renderItem 闭包复用（禁解构 observable）
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  if (service.moments.length === 0 && service.$model.loadFirst.loading) return <Loading />;

  return (
    <View style={styles.flex}>
      {/* 那年今日入口条（spec memories-today §5）：筛选条之上，有内容才渲染 */}
      <MemoriesEntryBar />
      <View style={styles.filters}>
        <Chip label="全部链" active={service.chainId == null} onPress={() => service.setChainFilter(undefined)} />
        {service.chainList.map((c) => (
          <Chip key={c.id} label={c.name} active={service.chainId === c.id} onPress={() => service.setChainFilter(c.id)} />
        ))}
        <Chip
          label={service.order === 'happened_at' ? '按发生时间' : '按添加时间'}
          active={false}
          onPress={() => service.toggleOrder()}
        />
      </View>
      {service.chainId != null && service.tags.length > 0 ? (
        <View style={styles.filters}>
          <Chip label="全部标签" active={service.tagId == null} onPress={() => service.setTagFilter(undefined)} />
          {service.tags.map((t) => (
            <Chip key={t.id} label={`#${t.name}`} active={service.tagId === t.id} onPress={() => service.setTagFilter(t.id)} />
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
      {service.$model.loadFirst.error ? <Text style={styles.errorBanner}>加载失败，下拉重试</Text> : null}
      <FlashList
        data={service.moments}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={service.$model.loadFirst.loading} onRefresh={() => void service.loadFirst().catch(() => undefined)} />
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
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {service.personId || service.place || service.tagId
                ? '没有符合条件的时刻'
                : '还没有时刻，发布第一条吧'}
            </Text>
          </View>
        }
        ListFooterComponent={service.$model.loadMore.loading ? <Text style={styles.loadingMore}>加载中…</Text> : null}
      />
      <Link href={{ pathname: '/compose' }} asChild>
        <Pressable style={styles.fab} onPress={() => undefined}>
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      </Link>
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
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: t.space3, paddingVertical: 6 },
    // 选中态对齐 SegmentBar：ink 色面 + bg 文字（中性、不抢 FAB 唯一实心高强调）
    chip: { paddingHorizontal: t.space3, paddingVertical: 6, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    chipActive: { backgroundColor: t.ink, borderColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.ink },
    chipTextActive: { color: t.bg },
    list: { paddingBottom: t.space4 },
    empty: { padding: 48, alignItems: 'center' },
    emptyText: { color: t.muted },
    loadingMore: { textAlign: 'center', color: t.muted, padding: t.space3 },
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 24,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.action,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
    },
    fabText: { color: t.actionFg, fontSize: 28, lineHeight: 32 },
    errorBanner: { color: t.danger, textAlign: 'center', padding: t.space2 },
  });
