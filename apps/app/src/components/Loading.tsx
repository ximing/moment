import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

export function Loading() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={t.action} />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  });
