import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { StatusBar } from 'expo-status-bar';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { ChainMemberPreview, MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { chainColorToken, resolveChainAppearanceColor } from '../../lib/chain-color';
import { babyAgeLabel } from '../../lib/template';
import { ActionSheet, ActionSheetItem } from '../../components/ActionSheet';
import { ChainMark } from '../../components/ChainMark';
import { FilterChips } from '../../components/FilterChips';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { SegmentBar, segmentBarHeight } from '../../components/SegmentBar';
import { UserAvatar } from '../../components/UserAvatar';
import { EmptyState } from '../../components/feedback';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { RecapEntryBar } from '../recap/recap-entry';
import { AggregateView } from './aggregate-views';
import { chainSheetItems } from './chain-sheet';
import { ChainOverlayNav, chainOverlayInset } from './chain-nav';
import { ChainCover, chainCoverHeight } from './cover';
import { FootprintMap } from './map-view';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const auth = useService(AuthService);
  const myId = auth.user?.id; // 在 observer 渲染内取值，renderItem 闭包复用（禁解构 observable）
  const [segment, setSegment] = useState<ChainSegment>('timeline');
  const [moreOpen, setMoreOpen] = useState(false);
  const [failedCoverId, setFailedCoverId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [identityH, setIdentityH] = useState(0);
  const [stuck, setStuck] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const coverH = chainCoverHeight(windowHeight);
  const overlayH = chainOverlayInset(insets.top, t);
  const moreItems = chainSheetItems(service.chain?.myRole);
  const chain = service.chain;
  const hasCover = Boolean(chain?.coverMediaId) && failedCoverId !== chain?.coverMediaId;
  const overlayCollapsed = !hasCover || collapsed;
  const mark = chain
    ? { id: chain.id, color: chain.color, icon: chain.icon, avatarUrl: chain.avatarUrl }
    : null;

  const viewTabs = (service.chain?.templateManifest?.views ?? [])
    .filter((v) => v.type !== 'timeline' || v.groupBy === 'trips')
    .map((v) => ({ value: v.type === 'timeline' ? ('trips' as const) : v.type, label: v.label }));
  const tabH = viewTabs.length > 0 ? segmentBarHeight(t) : 0;

  function onSegment(v: ChainSegment): void {
    setSegment(v);
    service.setActiveView(v);
    scrollY.setValue(0);
    setCollapsed(false);
    setStuck(false);
  }

  function openMoment(id: string): void {
    router.push(`/moments/${id}`);
  }

  function openMembers(): void {
    router.push({
      pathname: '/chains/[chainId]/settings',
      params: { chainId: service.chainId, section: 'members' },
    });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    scrollY.setValue(y);
    const coverGone = hasCover && y >= Math.max(coverH - overlayH, 0);
    setCollapsed((c) => (c === coverGone ? c : coverGone));
    const nextStuck =
      hasCover && tabH > 0 && identityH > 0 && y >= Math.max(coverH + identityH - overlayH, 0);
    setStuck((s) => (s === nextStuck ? s : nextStuck));
  }

  useEffect(() => {
    const id = Array.isArray(chainId) ? chainId[0] : chainId;
    if (id) service.hydrate(id);
  }, [service, chainId]);

  useEffect(() => {
    setFailedCoverId(null);
    scrollY.setValue(0);
    setCollapsed(false);
    setStuck(false);
    setIdentityH(0);
  }, [chain?.id, scrollY]);

  const chrome = chain ? (
    <>
      {hasCover ? (
        <ChainCover
          mediaId={chain.coverMediaId}
          src={chain.coverUrl}
          height={coverH}
          fallbackColor={chainColorToken(t, resolveChainAppearanceColor(chain.id, chain.color))}
          scrollY={scrollY}
          onError={() => setFailedCoverId(chain.coverMediaId)}
        />
      ) : (
        <View style={{ height: overlayH + tabH }} />
      )}
      {hasCover ? (
        <View
          style={styles.identity}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            setIdentityH((prev) => (prev === h ? prev : h));
          }}
        >
          <ChainMark chain={mark!} size={t.space8} />
          <View style={styles.identityText}>
            <Text style={styles.identityName} numberOfLines={1}>
              {chain.name}
            </Text>
            {chain.description ? (
              <Text style={styles.identityDesc} numberOfLines={2}>
                {chain.description}
              </Text>
            ) : null}
          </View>
          <CollaboratorStack members={chain.membersPreview} onPress={openMembers} />
        </View>
      ) : chain.description ? (
        <Text style={styles.looseDesc} numberOfLines={2}>
          {chain.description}
        </Text>
      ) : null}
      {hasCover && viewTabs.length > 0 ? (
        <View style={styles.viewTabsPage}>
          <SegmentBar
            options={[{ value: 'timeline', label: '时间线' }, ...viewTabs]}
            value={segment}
            onChange={onSegment}
          />
        </View>
      ) : null}
    </>
  ) : null;

  if (!chain) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <ChainOverlayNav
          title="链"
          chain={null}
          collapsed
          showActions={false}
          onSearch={() => undefined}
          onMore={() => undefined}
        />
        <Loading />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={hasCover && !collapsed ? 'light' : t.scheme === 'dark' ? 'light' : 'dark'} />
      {segment === 'timeline' ? (
        <View style={styles.timelinePane}>
          <FlashList
            data={service.moments}
            keyExtractor={(m) => m.id}
            style={styles.timelineList}
            contentContainerStyle={styles.list}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onEndReachedThreshold={0.4}
            onEndReached={() => void service.loadMore().catch(() => undefined)}
            ListHeaderComponent={
              <View>
                {chrome}
                <RecapEntryBar chainId={service.chainId} />
                <FilterChips
                  personId={service.personId}
                  personName={service.personName}
                  place={service.place}
                  onClearPerson={() => service.clearPersonFilter()}
                  onClearPlace={() => service.clearPlaceFilter()}
                />
              </View>
            }
            renderItem={({ item }: { item: MomentResponse }) => (
              <View style={styles.cardPad}>
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
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.cardPad}>
                {service.personId || service.place ? (
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
                )}
              </View>
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
      ) : (
        <ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.aggregate}
        >
          {chrome}
          <AggregateView
            view={segment}
            aggregate={service.aggregate}
            moments={service.moments}
            chainPayload={service.chain?.payload ?? null}
            hasMore={service.hasMore}
            isLoading={service.$model.loadAggregate.loading}
            error={service.$model.loadAggregate.error ? humanError(service.$model.loadAggregate.error) : null}
            onRetry={() => void service.loadAggregate().catch(() => undefined)}
            onMomentPress={openMoment}
            map={(props) => <FootprintMap {...props} onMomentPress={openMoment} />}
          />
        </ScrollView>
      )}

      {viewTabs.length > 0 && (!hasCover || stuck) ? (
        <View style={[styles.viewTabs, { top: overlayH }, styles.viewTabsPage]}>
          <SegmentBar
            options={[{ value: 'timeline', label: '时间线' }, ...viewTabs]}
            value={segment}
            onChange={onSegment}
          />
        </View>
      ) : null}

      <ChainOverlayNav
        title={chain.name}
        chain={mark}
        collapsed={overlayCollapsed}
        showActions
        onSearch={() => router.push({ pathname: '/search', params: { chainId: service.chainId } })}
        onMore={() => setMoreOpen(true)}
      />

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

function CollaboratorStack({
  members,
  onPress,
}: {
  members: ChainMemberPreview[];
  onPress: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const shown = (members ?? []).slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${members.length} 位协作人`}
      onPress={onPress}
      hitSlop={{ top: t.space1, bottom: t.space1 }}
      style={styles.collabStack}
    >
      {shown.map((m, i) => (
        <View
          key={m.userId}
          style={[
            styles.collabItem,
            {
              marginLeft: i === 0 ? 0 : -t.space2,
              zIndex: shown.length - i,
              borderColor: t.bg,
            },
          ]}
        >
          <UserAvatar url={m.avatarUrl} name={m.nickname} size={t.space6} />
        </View>
      ))}
    </Pressable>
  );
}

export const ChainHomePage = bindServices(Content, [ChainHomeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space3,
      paddingHorizontal: t.space4,
      paddingTop: t.space4,
      paddingBottom: t.space2,
    },
    identityText: { flex: 1, minWidth: 0, gap: t.space1 },
    identityName: { fontSize: t.fontInput, fontWeight: '600', color: t.ink },
    identityDesc: { fontSize: t.fontSupport, color: t.muted },
    looseDesc: {
      paddingHorizontal: t.space4,
      paddingBottom: t.space2,
      fontSize: t.fontSupport,
      color: t.muted,
    },
    list: { paddingBottom: t.space8 },
    cardPad: { paddingHorizontal: t.space3 },
    aggregate: { paddingBottom: t.space8 },
    timelinePane: { flex: 1 },
    timelineList: { flex: 1 },
    viewTabs: {
      position: 'absolute',
      left: 0,
      right: 0,
      zIndex: t.space4,
      elevation: t.space1,
    },
    viewTabsPage: { backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line },
    collabStack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
    collabItem: {
      borderWidth: 2,
      borderRadius: t.space6,
      overflow: 'hidden',
    },
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
