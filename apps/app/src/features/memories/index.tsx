import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { OverlayNav } from '../../components/OverlayNav';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { Banner, EmptyState } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { MemoriesService } from './memories.service';
import { isDateKey, memoriesBarText, todayKey, yearGroupText } from './text';

/**
 * 入口条（spec memories-today §5）：(tabs) 时间线顶部筛选条之上。
 * 有周年内容才渲染——加载中 / 失败 / 无内容整条隐藏（不打扰）；
 * 点击 push 详情页，并把本条定格的 date 作为 param 带过去。
 */
export const MemoriesEntryBar = bindServices(
  observer(function MemoriesEntryBar() {
    const service = useService(MemoriesService);
    const [date] = useState(() => todayKey()); // 挂载时定格为字符串（spec §5 跨午夜不漂移）
    const t = useTheme();
    const styles = useMemo(() => createStyles(t), [t]);
    useEffect(() => {
      service.hydrate(date);
    }, [service, date]);

    const summary = service.summary;
    if (!summary) return null;

    return (
      <Pressable
        style={styles.bar}
        onPress={() => router.push({ pathname: '/memories/today', params: { date: service.date } })}
      >
        <Icon name="calendar" size={t.fontLabel} />
        <Text style={styles.barText}>{memoriesBarText(summary)}</Text>
        <Icon name="chevron-right" size={t.fontLabel} />
      </Pressable>
    );
  }),
  [MemoriesService],
);

/** 详情页（spec §5）：标题「往年今日」，按年份分组复用 MomentCard，点击进 /moments/:id。 */
const MemoriesContent = observer(function MemoriesContent() {
  const params = useLocalSearchParams<{ date?: string }>();
  const service = useService(MemoriesService);
  // hydrate 时定格：入口条带来的 date 优先（不合法/缺省回退设备本地今天）；
  // useState 初值保证页面存活跨午夜不漂移。
  const [date] = useState(() => (params.date && isDateKey(params.date) ? params.date : todayKey()));
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  useEffect(() => {
    service.hydrate(date);
  }, [service, date]);

  const loading = service.$model.load.loading;
  const error = service.$model.load.error;

  if (service.years.length === 0 && loading) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="往年今日" />
        <Loading />
      </View>
    );
  }

  if (service.years.length === 0 && error) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="往年今日" />
        <View style={styles.center}>
          <Banner
            tone="error"
            action={{ label: '重试', onPress: () => void service.load(date).catch(() => undefined) }}
          >
            加载失败
          </Banner>
          <Button variant="quiet" onPress={() => router.back()}>
            返回
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <OverlayNav title="往年今日" />
      {service.years.length === 0 ? (
        <EmptyState
          variant="timeline"
          scope="page"
          title="往年的今天还没有时刻"
          description="记下此刻，明年就会在这儿遇见。"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {service.years.map((g) => (
            <View key={g.year} style={styles.group}>
              <Text style={styles.groupHead}>{yearGroupText(g.year, g.moments.length)}</Text>
              {g.moments.map((m) => (
                <MomentCard key={m.id} moment={m} onPress={() => router.push(`/moments/${m.id}`)} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
});

export const MemoriesTodayPage = bindServices(MemoriesContent, [MemoriesService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: t.space3,
      marginTop: t.space2,
      marginBottom: 2,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
    },
    barText: { flex: 1, fontSize: t.fontLabel, color: t.ink, marginLeft: t.space1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space8, gap: t.space3 },
    list: { paddingHorizontal: t.space3, paddingBottom: t.space6 },
    group: { marginTop: t.space3 },
    groupHead: { paddingHorizontal: t.space1, paddingVertical: t.space2, fontSize: t.fontLabel, fontWeight: '600', color: t.ink },
  });
