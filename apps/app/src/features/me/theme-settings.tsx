import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemeToggle } from '../../components/ThemeToggle';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

export function ThemeSettingsPage() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.body}>
      <View style={styles.section}>
        <Text style={styles.hint}>浅色、深色，或跟随系统。</Text>
        <ThemeToggle />
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    body: { flex: 1, padding: t.space4, backgroundColor: t.bg },
    section: { gap: t.space3 },
    hint: { fontSize: t.fontSupport, color: t.muted },
  });
