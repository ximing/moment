import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 全屏加载：进页数据未到时用，避免空白闪一下。 */
export function Loading({ label = '加载中' }: { label?: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const opacity = useRef(new Animated.Value(t.disabledOpacity)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: t.easeMs * 4, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: t.disabledOpacity, duration: t.easeMs * 4, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, t.disabledOpacity, t.easeMs]);

  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={t.action} />
      <Animated.Text style={[styles.label, { opacity }]}>{label}</Animated.Text>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space3,
      backgroundColor: t.bg,
    },
    label: { fontSize: t.fontSupport, color: t.muted },
  });
