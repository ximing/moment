import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { RecapEntryService } from './recap-entry.service';

// recap 入口条（spec §7）：与那年今日入口条同视觉模式——
// 有内容才渲染（if !latest return null），点击 router.push 到 recap 页。

/** period 格式化为展示文案：「2026-07」→「7 月回顾」 */
function periodLabel(period: string): string {
  const month = period.slice(5);
  return `${Number(month)} 月回顾`;
}

const RecapEntryBarContent = observer(function RecapEntryBarContent({
  chainId,
}: {
  chainId: string;
}) {
  const service = useService(RecapEntryService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  const latest = service.latest;
  if (!latest) return null;

  const degraded = latest.status === 'degraded';

  return (
    <Pressable
      style={styles.bar}
      onPress={() =>
        router.push({
          pathname: '/chains/[chainId]/recaps/[period]',
          params: { chainId, period: latest.period },
        })
      }
    >
      <Icon name="calendar" size={t.fontLabel} />
      <Text style={styles.barText}>{periodLabel(latest.period)}</Text>
      {degraded ? <Text style={styles.barTag}>（简版）</Text> : null}
      <Text style={styles.barArrow}>→</Text>
    </Pressable>
  );
});

export const RecapEntryBar = bindServices(RecapEntryBarContent, [RecapEntryService]);

// recap 入口条为新代码，间距/圆角上 token 档位（space1/space2/radiusMd），与 recap-page highlightCard 自洽。
const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: t.space3,
      marginTop: t.space2,
      marginBottom: t.space1,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      minHeight: t.touchMin,
    },
    barText: { flex: 1, fontSize: t.fontLabel, color: t.ink, marginLeft: t.space1 },
    barTag: { fontSize: t.fontCaption, color: t.muted, marginLeft: t.space1 },
    barArrow: { fontSize: t.fontLabel, color: t.muted, marginLeft: t.space2 },
  });
