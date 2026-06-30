import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 选中态 = ink 色面 + bg 文字（中性、不抢页面唯一主动作，spec §6 拍板项 5） */
export function SegmentBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Pressable key={o.value} style={[styles.seg, value === o.value && styles.segActive]} onPress={() => onChange(o.value)}>
          <Text style={[styles.segText, value === o.value && styles.segTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: 6, paddingHorizontal: t.space3, paddingVertical: t.space2, backgroundColor: t.surface },
    seg: { flex: 1, paddingVertical: t.space2, borderRadius: 8, backgroundColor: t.hoverSoft, alignItems: 'center' },
    segActive: { backgroundColor: t.ink },
    segText: { color: t.muted, fontSize: t.fontSupport },
    segTextActive: { color: t.bg, fontWeight: '600' },
  });
