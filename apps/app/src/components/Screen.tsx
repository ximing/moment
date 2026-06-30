import { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

export function Screen({ children, scroll = false, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (scroll) {
    return (
      <SafeAreaView style={[styles.flex, style]}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return <SafeAreaView style={[styles.flex, style]}>{<View style={styles.flex}>{children}</View>}</SafeAreaView>;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    scrollContent: { padding: t.space4, gap: t.space3 },
  });
