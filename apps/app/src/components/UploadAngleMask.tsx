import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { unsentSectorPath } from './upload-angle';

/** 图片 / 录音上传遮罩：已发送的角度变透明，剩下的扇区仍盖住。 */
export function UploadAngleMask({ progress }: { progress: number }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const ratio = Number.isFinite(progress) ? Math.max(0, Math.min(progress, 1)) : 0;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  if (ratio >= 1) return null;
  const pct = Math.round(ratio * 100);
  const path = size ? unsentSectorPath(ratio, size.w, size.h) : null;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityRole="progressbar"
      accessibilityLabel="上传进度"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }}
    >
      {path == null || size == null ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]} />
      ) : (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          <Path d={path} fill={t.scrim} />
        </Svg>
      )}
      <View style={styles.labelLayer}>
        <Text style={styles.pct} accessibilityElementsHidden importantForAccessibility="no">
          {pct}%
        </Text>
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    labelLayer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pct: {
      overflow: 'hidden',
      paddingHorizontal: t.space2,
      paddingVertical: t.space1,
      borderRadius: t.buttonRadius,
      backgroundColor: t.overlayCapsuleOnMedia,
      color: t.actionFg,
      fontSize: t.fontCaption,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
