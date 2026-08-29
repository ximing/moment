import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 列表顶清除 chip（spec §7.1）。app 无 before 日历，不渲染「回到今天」（偏差 13）。 */
export function FilterChips({
  personId,
  personName,
  place,
  onClearPerson,
  onClearPlace,
}: {
  personId?: string;
  personName?: string;
  place?: string;
  onClearPerson: () => void;
  onClearPlace: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const hasPerson = Boolean(personId);
  const hasPlace = Boolean(place);
  if (!hasPerson && !hasPlace) return null;
  return (
    <View style={styles.row}>
      {hasPerson ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`清除人物筛选 ${personName ?? '人物'}`}
          onPress={onClearPerson}
          style={styles.chip}
        >
          <Text style={styles.chipText}>{personName ?? '人物'} ×</Text>
        </Pressable>
      ) : null}
      {hasPlace ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`清除地点筛选 ${place}`}
          onPress={onClearPlace}
          style={styles.chip}
        >
          <Text style={styles.chipText}>📍 {place} ×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.space2,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
    },
    chip: {
      paddingHorizontal: t.space3,
      minHeight: t.touchMin,
      justifyContent: 'center',
      borderRadius: t.radiusMd,
      backgroundColor: t.hoverSoft,
    },
    chipText: { fontSize: t.fontSupport, color: t.ink },
  });
