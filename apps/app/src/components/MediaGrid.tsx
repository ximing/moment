import { useMemo, useState } from 'react';
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentMedia } from '@moment/dto';
import { cardDisplayUrl, isHttpUrl, posterDisplayUrl } from '../lib/media-src';
import { cardImageVariant, posterCardVariant } from '../lib/media-variant';
import { useMediaUri } from '../lib/use-media-uri';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

function MediaImage({ media, cellStyle }: { media: MomentMedia; cellStyle: object }) {
  const signed = cardDisplayUrl(media);
  const variant = cardImageVariant(media.derivedUrl);
  const fetched = useMediaUri(isHttpUrl(signed) ? undefined : media.id, {
    variant,
    fallbackToOriginal: variant === 'derived',
  });
  const uri = isHttpUrl(signed) ? signed : fetched;
  if (!uri) return <View style={cellStyle} />;
  return <Image source={{ uri }} style={cellStyle} resizeMode="cover" />;
}

function VideoCell({ m, cellStyle, styles }: { m: MomentMedia; cellStyle: object; styles: ReturnType<typeof createStyles> }) {
  const signed = posterDisplayUrl(m);
  const pVariant = posterCardVariant(m.posterDerivedUrl);
  const fetched = useMediaUri(isHttpUrl(signed) ? undefined : (m.posterMediaId ?? undefined), {
    variant: pVariant,
    fallbackToOriginal: pVariant === 'derived',
  });
  const uri = isHttpUrl(signed) ? signed : fetched;
  return (
    <View style={[cellStyle, styles.videoCell]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <Text style={styles.play}>▶</Text>
      {m.duration != null && m.duration > 0 ? <Text style={styles.duration}>{formatDuration(m.duration)}</Text> : null}
      <Text style={styles.videoHint}>视频 · 进详情播放</Text>
    </View>
  );
}

export function MediaGrid({ media, onRemove }: { media: MomentMedia[]; onRemove?: (mediaId: string) => void }) {
  const t = useTheme();
  const [rowWidth, setRowWidth] = useState(
    () => Dimensions.get('window').width - t.space3 * 2 - t.space4 * 2,
  );
  const styles = useMemo(() => createStyles(t, rowWidth), [t, rowWidth]);
  if (media.length === 0) return null;
  return (
    <View
      style={styles.grid}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - rowWidth) >= 1) setRowWidth(w);
      }}
    >
      {media.map((m) => {
        const isVideo = m.mime.startsWith('video/');
        const isImage = m.mime.startsWith('image/');
        if (!isVideo && !isImage) return null;
        if (!onRemove) {
          return isVideo ? (
            <VideoCell key={m.id} m={m} cellStyle={styles.cell} styles={styles} />
          ) : (
            <MediaImage key={m.id} media={m} cellStyle={styles.cell} />
          );
        }
        return (
          <View key={m.id} style={styles.cellWrap}>
            {isVideo ? (
              <View style={[styles.cellFill, styles.videoPlaceholder]}>
                <Text style={styles.videoPlaceholderLabel}>视频</Text>
              </View>
            ) : (
              <MediaImage media={m} cellStyle={styles.cellFill} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isVideo ? '移除这段视频' : '移除这张图片'}
              hitSlop={t.space3}
              onPress={() => onRemove(m.id)}
              style={styles.removeBtn}
            >
              <Text style={styles.removeBtnText}>×</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (t: Theme, rowWidth: number) => {
  const columns = 3;
  const gap = t.space1;
  const size = Math.max(0, Math.floor((rowWidth - gap * (columns - 1)) / columns));
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap,
      marginTop: t.space2,
      width: '100%',
    },
    cell: { width: size, height: size, borderRadius: t.buttonRadius, backgroundColor: t.feedbackSkeleton, overflow: 'hidden' },
    cellWrap: { width: size, height: size },
    cellFill: { width: '100%', height: '100%', borderRadius: t.buttonRadius, backgroundColor: t.feedbackSkeleton, overflow: 'hidden' },
    // 视频占位走 ink 反色档，其上文字用 bg / muted（spec §4.1）
    videoCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.ink, overflow: 'hidden' },
    play: { color: t.bg, fontSize: 26 },
    duration: { color: t.bg, fontSize: t.fontCaption, marginTop: t.space1 },
    videoHint: { color: t.muted, fontSize: 10, marginTop: t.space1 },
    videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.ink },
    videoPlaceholderLabel: { color: t.bg, fontSize: t.fontCaption },
    removeBtn: {
      position: 'absolute',
      top: t.space1,
      right: t.space1,
      minWidth: t.space6,
      minHeight: t.space6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.ink,
      borderRadius: t.radiusMd,
    },
    removeBtnText: { color: t.bg, fontSize: t.fontCaption },
  });
};
