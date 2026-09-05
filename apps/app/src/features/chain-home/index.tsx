import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { babyAgeLabel } from '../../lib/template';
import { FilterChips } from '../../components/FilterChips';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { Button } from '../../components/Button';
import { EmptyState, confirm, toast } from '../../components/feedback';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { RecapEntryBar } from '../recap/recap-entry';
import { AggregateView } from './aggregate-views';
import { FootprintMap } from './map-view';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

function showChainMenu({
  views,
  onView,
  onSettings,
}: {
  views: { value: string; label: string }[];
  onView: (v: string) => void;
  onSettings: () => void;
}): void {
  const items = [{ value: 'timeline', label: '时间线' }, ...views, { value: 'tags', label: '标签' }];
  const labels = items.map((i) => i.label);
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...labels, '设置', '取消'],
        cancelButtonIndex: labels.length + 1,
      },
      (index) => {
        if (index === undefined || index === labels.length + 1) return;
        if (index === labels.length) {
          onSettings();
          return;
        }
        const item = items[index];
        if (item) onView(item.value);
      },
    );
    return;
  }
  Alert.alert('这条链', undefined, [
    ...items.map((item) => ({ text: item.label, onPress: () => onView(item.value) })),
    { text: '设置', onPress: onSettings },
    { text: '取消', style: 'cancel' as const },
  ]);
}

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const auth = useService(AuthService);
  const myId = auth.user?.id; // 在 observer 渲染内取值，renderItem 闭包复用（禁解构 observable）
  const [segment, setSegment] = useState<ChainSegment>('timeline');
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();

  function onSegment(v: ChainSegment): void {
    setSegment(v);
    service.setActiveView(v);
  }

  const viewTabs = (service.chain?.templateManifest?.views ?? [])
    .filter((v) => v.type !== 'timeline' || v.groupBy === 'trips')
    .map((v) => ({ value: v.type === 'timeline' ? ('trips' as const) : v.type, label: v.label }));

  const currentViewLabel =
    segment === 'timeline'
      ? '时间线'
      : segment === 'tags'
        ? '标签'
        : (viewTabs.find((v) => v.value === segment)?.label ?? segment);

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
              onPress={() =>
                showChainMenu({
                  views: viewTabs,
                  onView: onSegment,
                  onSettings: () => router.push(`/chains/${service.chainId}/settings`),
                })
              }
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
      {segment !== 'timeline' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`返回时间线，当前 ${currentViewLabel}`}
          onPress={() => onSegment('timeline')}
          style={styles.contextBar}
        >
          <Text style={styles.contextText}>{currentViewLabel}</Text>
          <Text style={styles.contextBack}>返回时间线</Text>
        </Pressable>
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

      {segment === 'tags' ? <TagsSection service={service} /> : null}

      {segment !== 'timeline' && segment !== 'tags' ? (
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
    </View>
  );
});

/** 标签段需要本地输入框 state，拆成子组件——service 经 props 传入（同一 bindServices 实例，
 *  与 web chain-settings 的 sections.tsx 同款；子块自身只 observer，不再 useService）。 */
const TagsSection = observer(function TagsSection({ service }: { service: ChainHomeService }) {
  const [name, setName] = useState('');
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  function onDelete(tagId: string, tagName: string): void {
    void confirm({
      title: '删除标签',
      body: `删除「${tagName}」将从相关时刻上移除`,
      confirmLabel: '删除',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void service.deleteTag(tagId).catch((err) => toast.error(err));
    });
  }

  return (
    <View style={styles.section}>
      <View style={styles.tagCreate}>
        <TextInput
          style={styles.tagInput}
          value={name}
          onChangeText={setName}
          placeholder="新标签名（链内唯一，上限 100 个）"
          placeholderTextColor={t.muted}
        />
        <Button
          variant="secondary"
          onPress={() =>
            void service
              .addTag(name)
              .then(() => setName(''))
              .catch((err) => toast.error(err))
          }
        >
          添加
        </Button>
      </View>
      {service.tags.map((tag) => (
        <View key={tag.id} style={styles.row}>
          <Text style={styles.rowMain}>#{tag.name}（{tag.momentCount} 条）</Text>
          <Pressable onPress={() => onDelete(tag.id, tag.name)}>
            <Text style={styles.danger}>删除</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
});

export const ChainHomePage = bindServices(Content, [ChainHomeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    headerBtn: { width: t.touchMin, height: t.touchMin, alignItems: 'center', justifyContent: 'center' },
    contextBar: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: t.touchMin,
      paddingHorizontal: t.space4,
      backgroundColor: t.surface,
      gap: t.space2,
    },
    contextText: { flex: 1, minWidth: 0, fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    contextBack: { fontSize: t.fontSupport, color: t.muted },
    list: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space8 },
    timelinePane: { flex: 1 },
    timelineList: { flex: 1 },
    section: { padding: t.space4, gap: t.space3 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.surface,
      borderRadius: t.radiusMd,
      padding: t.space3,
    },
    rowMain: { flex: 1, fontSize: t.fontBody, color: t.ink },
    tagCreate: { flexDirection: 'row', gap: t.space2, alignItems: 'center' },
    tagInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: t.fieldRadius,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      backgroundColor: t.surface,
      color: t.ink,
    },
    danger: { color: t.danger, fontSize: t.fontSupport },
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
