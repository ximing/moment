import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** Tab 页自定义顶栏：吃掉状态栏安全区，替代系统 header 标题。 */
export function TabHeader({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + t.space2 }]}>
      {children}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      paddingHorizontal: t.space3,
      paddingBottom: t.space2,
      backgroundColor: t.bg,
      minHeight: t.touchMin,
    },
  });
