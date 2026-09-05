import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import type { CapsuleTone } from './OverlayNav';

/** 钉在顶栏下的视图切换：等分 + 底边指示，高度 compact，命中区用 hitSlop 补齐。 */
export function segmentBarHeight(t: Theme): number {
  return t.space8 + t.space2;
}

export function SegmentBar<T extends string>({
  options,
  value,
  onChange,
  tone = 'page',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  tone?: CapsuleTone;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const onMedia = tone === 'media';
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: t.space1, bottom: t.space1 }}
            style={[styles.seg, active && (onMedia ? styles.segActiveMedia : styles.segActive)]}
            onPress={() => onChange(o.value)}
          >
            <Text
              numberOfLines={1}
              style={[
                onMedia ? styles.segTextMedia : styles.segText,
                active && (onMedia ? styles.segTextActiveMedia : styles.segTextActive),
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      minHeight: t.space8 + t.space2,
      paddingHorizontal: t.space2,
    },
    seg: {
      flex: 1,
      minHeight: t.space8 + t.space2,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    segActive: { borderBottomColor: t.action },
    segActiveMedia: { borderBottomColor: t.select },
    segText: { color: t.muted, fontSize: t.fontSupport },
    segTextActive: { color: t.ink, fontWeight: '600' },
    segTextMedia: { color: t.actionFg, fontSize: t.fontSupport, opacity: t.disabledOpacity + 0.3 },
    segTextActiveMedia: { color: t.actionFg, fontWeight: '600', opacity: 1 },
  });
