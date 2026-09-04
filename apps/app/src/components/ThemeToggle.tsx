import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  THEME_CHOICE_OPTIONS,
  getThemeChoice,
  setThemeChoice,
  subscribeThemeChoice,
  type ThemeChoice,
} from '../theme/preference';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 三态分段主题开关：跟随系统 / 浅 / 深（对齐 web ThemeToggle）。 */
export function ThemeToggle() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice);

  useEffect(() => subscribeThemeChoice(setChoice), []);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="主题" style={styles.row}>
      {THEME_CHOICE_OPTIONS.map((o) => {
        const active = choice === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: t.space1, bottom: t.space1 }}
            onPress={() => setThemeChoice(o.value)}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space1, flexWrap: 'wrap' },
    option: {
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.controlHProminent,
      minHeight: t.touchMin,
      justifyContent: 'center',
    },
    optionActive: { backgroundColor: t.select },
    label: { fontSize: t.fontLabel, color: t.muted },
    labelActive: { color: t.selectFg, fontWeight: '600' },
  });
