import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { RecapMarkdownText } from './recap-markdown';
import { RecapPageService } from './recap-page.service';
import { Loading } from '../../components/Loading';
import { OverlayNav } from '../../components/OverlayNav';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// recap 详情页（spec §7）：Markdown 正文 + 高光时刻区（点击跳转 moment 详情）。
// 三态：loading / error（重试）/ 内容。

const RecapPageContent = observer(function RecapPageContent() {
  const params = useLocalSearchParams<{ chainId: string; period: string }>();
  const chainId = params.chainId ?? '';
  const period = params.period ?? '';
  const service = useService(RecapPageService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(chainId, period);
  }, [service, chainId, period]);

  const recap = service.recap;
  const loading = service.$model.load.loading;
  const error = service.$model.load.error;

  if (!recap && (loading || !error)) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="月度回顾" />
        <Loading />
      </View>
    );
  }
  if (!recap) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="月度回顾" />
        <View style={styles.center}>
          <Text style={styles.errorText}>加载失败</Text>
          <Pressable onPress={() => void service.load().catch(() => undefined)}>
            <Text style={styles.action}>重试</Text>
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.action}>返回</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const monthLabel = `${Number(period.slice(5))} 月回顾`;
  const title = recap.status === 'degraded' ? `${monthLabel}（简版）` : monthLabel;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <OverlayNav title={title} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <RecapMarkdownText content={recap.content} />
        {service.highlights.length > 0 ? (
          <View style={styles.highlights}>
            <Text style={styles.sectionTitle}>高光时刻</Text>
            {service.highlights.map((m) => (
              <Pressable
                key={m.id}
                style={styles.highlightCard}
                onPress={() => router.push(`/moments/${m.id}`)}
              >
                {m.content.length > 0 ? (
                  <Text style={styles.highlightContent} numberOfLines={3}>{m.content}</Text>
                ) : null}
                <Text style={styles.highlightDate}>
                  {new Date(m.happenedAt).toLocaleDateString('zh-CN')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
});

export const RecapPage = bindServices(RecapPageContent, [RecapPageService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    scroll: { padding: t.space4, gap: t.space4 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space8, gap: t.space3 },
    errorText: { color: t.danger, fontSize: t.fontLabel },
    action: { color: t.action, fontSize: t.fontBody, paddingVertical: t.space1 },
    highlights: { gap: t.space2, marginTop: t.space4 },
    sectionTitle: { fontSize: t.fontBody, fontWeight: '600', color: t.ink },
    highlightCard: { backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1, minHeight: t.touchMin },
    highlightContent: { fontSize: t.fontBody, color: t.ink },
    highlightDate: { fontSize: t.fontCaption, color: t.muted },
  });
