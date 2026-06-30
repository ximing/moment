import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
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
        <Text style={styles.barText}>📅 {memoriesBarText(summary)}</Text>
        <Text style={styles.barArrow}>→</Text>
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
        <Stack.Screen options={{ title: '往年今日' }} />
        <Loading />
      </View>
    );
  }

  if (service.years.length === 0 && error) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ title: '往年今日' }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>加载失败</Text>
          <Pressable onPress={() => void service.load(date).catch(() => undefined)}>
            <Text style={styles.action}>重试</Text>
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.action}>返回</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: '往年今日' }} />
      {service.years.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>往年的今天还没有时刻</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {service.years.map((g) => (
            <View key={g.year} style={styles.group}>
              <Text style={styles.groupHead}>{yearGroupText(g.year, g.moments.length)}</Text>
              <View style={styles.groupBody}>
                {g.moments.map((m) => (
                  <MomentCard key={m.id} moment={m} onPress={() => router.push(`/moments/${m.id}`)} />
                ))}
              </View>
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
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
    },
    barText: { flex: 1, fontSize: t.fontLabel, color: t.ink },
    barArrow: { fontSize: t.fontLabel, color: t.muted, marginLeft: t.space2 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space8, gap: t.space3 },
    errorText: { color: t.danger, fontSize: t.fontLabel },
    action: { color: t.action, fontSize: t.fontBody, paddingVertical: t.space1 },
    empty: { color: t.muted },
    list: { paddingBottom: t.space6 },
    group: { marginTop: t.space3 },
    groupHead: { paddingHorizontal: t.space4, paddingVertical: 6, fontSize: t.fontLabel, fontWeight: '600', color: t.ink },
    groupBody: { backgroundColor: t.surface },
  });
