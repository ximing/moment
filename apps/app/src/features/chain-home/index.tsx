import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { babyAgeLabel } from '../../lib/template';
import { ActionSheet, ActionSheetItem } from '../../components/ActionSheet';
import { FilterChips } from '../../components/FilterChips';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { SegmentBar } from '../../components/SegmentBar';
import { EmptyState } from '../../components/feedback';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { RecapEntryBar } from '../recap/recap-entry';
import { AggregateView } from './aggregate-views';
import { chainSheetItems } from './chain-sheet';
import { FootprintMap } from './map-view';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const auth = useService(AuthService);
  const myId = auth.user?.id; // 在 observer 渲染内取值，renderItem 闭包复用（禁解构 observable）
  const [segment, setSegment] = useState<ChainSegment>('timeline');
  const [moreOpen, setMoreOpen] = useState(false);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const moreItems = chainSheetItems(service.chain?.myRole);

  function onSegment(v: ChainSegment): void {
    setSegment(v);
    service.setActiveView(v);
  }

  const viewTabs = (service.chain?.templateManifest?.views ?? [])
    .filter((v) => v.type !== 'timeline' || v.groupBy === 'trips')
    .map((v) => ({ value: v.type === 'timeline' ? ('trips' as const) : v.type, label: v.label }));

  useEffect(() => {
    const id = Array.isArray(chainId) ? chainId[0] : chainId;
    if (id) service.hydrate(id);
  }, [service, chainId]);

  const header = (
    <Stack.Screen
      options={{
        title: service.chain?.name ?? '链',
        headerRight: () => (
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="搜索时刻"
              onPress={() => router.push({ pathname: '/search', params: { chainId: service.chainId } })}
              style={styles.headerBtn}
            >
              <Icon name="search" size={t.fontInput} color={t.ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="更多"
              onPress={() => setMoreOpen(true)}
              style={styles.headerBtn}
            >
              <Icon name="ellipsis" size={t.fontInput} color={t.ink} />
            </Pressable>
          </View>
        ),
      }}
    />
  );

  if (!service.chain) {
    return (
      <View style={styles.flex}>
        {header}
        <Loading />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {header}
      {viewTabs.length > 0 ? (
        <SegmentBar
          options={[{ value: 'timeline', label: '时间线' }, ...viewTabs]}
          value={segment}
          onChange={onSegment}
        />
      ) : null}

      {segment === 'timeline' ? (
        <View style={styles.timelinePane}>
          <RecapEntryBar chainId={service.chainId} />
          <FilterChips
            personId={service.personId}
            personName={service.personName}
            place={service.place}
            onClearPerson={() => service.clearPersonFilter()}
            onClearPlace={() => service.clearPlaceFilter()}
          />
          <FlashList
            data={service.moments}
            keyExtractor={(m) => m.id}
            style={styles.timelineList}
            contentContainerStyle={styles.list}
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
                templateManifest={service.chain?.templateManifest ?? null}
                ageLabel={(() => {
                  const birthdate = service.chain?.payload?.birthdate;
                  return typeof birthdate === 'string' ? babyAgeLabel(birthdate, item.happenedAt, item.happenedTzOffset) : undefined;
                })()}
                onPersonFilter={(p) => service.togglePersonFilter(p)}
                onPlaceFilter={(place) => service.togglePlaceFilter(place)}
              />
            )}
            ListEmptyComponent={
              service.personId || service.place ? (
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
                  description="这条链的第一刻，等你来写下。"
                  action={
                    service.canCompose
                      ? {
                          label: '记下此刻',
                          emphasis: 'primary',
                          onPress: () =>
                            router.push({ pathname: '/compose', params: { chainId: service.chainId } }),
                        }
                      : undefined
                  }
                />
              )
            }
          />
          {service.canCompose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="记下此刻"
              style={[styles.fab, { bottom: Math.max(insets.bottom, t.space4) + t.space4 }]}
              onPress={() => router.push({ pathname: '/compose', params: { chainId: service.chainId } })}
            >
              <Icon name="plus" size={t.space6} color={t.actionFg} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {segment !== 'timeline' ? (
        <ScrollView>
          <AggregateView
            view={segment}
            aggregate={service.aggregate}
            moments={service.moments}
            chainPayload={service.chain?.payload ?? null}
            hasMore={service.hasMore}
            isLoading={service.$model.loadAggregate.loading}
            error={service.$model.loadAggregate.error ? humanError(service.$model.loadAggregate.error) : null}
            onRetry={() => void service.loadAggregate().catch(() => undefined)}
            map={(props) => <FootprintMap {...props} />}
          />
        </ScrollView>
      ) : null}

      <ActionSheet visible={moreOpen} title="这条链" onClose={() => setMoreOpen(false)}>
        {moreItems.map((item) => (
          <ActionSheetItem
            key={item.key}
            label={item.label}
            onPress={() => {
              setMoreOpen(false);
              router.push({
                pathname: '/chains/[chainId]/settings',
                params: { chainId: service.chainId, section: item.key },
              });
            }}
          />
        ))}
      </ActionSheet>
    </View>
  );
});

export const ChainHomePage = bindServices(Content, [ChainHomeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    headerBtn: { width: t.touchMin, height: t.touchMin, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space8 },
    timelinePane: { flex: 1 },
    timelineList: { flex: 1 },
    fab: {
      position: 'absolute',
      right: t.space5,
      width: t.controlHProminent + t.space3,
      height: t.controlHProminent + t.space3,
      borderRadius: (t.controlHProminent + t.space3) / 2,
      backgroundColor: t.action,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: t.space1,
    },
  });
