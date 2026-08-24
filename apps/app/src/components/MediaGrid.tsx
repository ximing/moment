import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { MomentMedia } from '@moment/dto';
import { useMediaUri } from '../lib/use-media-uri';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

function MediaImage({ mediaId, cellStyle }: { mediaId: string; cellStyle: object }) {
  const uri = useMediaUri(mediaId);
  if (!uri) return <View style={cellStyle} />;
  return <Image source={{ uri }} style={cellStyle} resizeMode="cover" />;
}

function VideoCell({ m, cellStyle, styles }: { m: MomentMedia; cellStyle: object; styles: ReturnType<typeof createStyles> }) {
  // useMediaUri 签名是 string | undefined（use-media-uri.ts:6）：posterMediaId 为 null 时归一为 undefined，不发请求
  const uri = useMediaUri(m.posterMediaId ?? undefined);
  return (
    <View style={[cellStyle, styles.videoCell]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <Text style={styles.play}>▶</Text>
      {m.duration != null && m.duration > 0 ? <Text style={styles.duration}>{formatDuration(m.duration)}</Text> : null}
      <Text style={styles.videoHint}>视频 · 进详情播放</Text>
    </View>
  );
}

export function MediaGrid({ media }: { media: MomentMedia[] }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (media.length === 0) return null;
  return (
    <View style={styles.grid}>
      {media.map((m) =>
        m.mime.startsWith('video/') ? (
          <VideoCell key={m.id} m={m} cellStyle={styles.cell} styles={styles} />
        ) : m.mime.startsWith('image/') ? (
          <MediaImage key={m.id} mediaId={m.id} cellStyle={styles.cell} />
        ) : null
      )}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space1, marginTop: t.space2 },
    cell: { width: '32%', aspectRatio: 1, borderRadius: 6, backgroundColor: t.feedbackSkeleton },
    // 视频占位走 ink 反色档，其上文字用 bg / muted（spec §4.1）
    videoCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.ink, overflow: 'hidden' },
    play: { color: t.bg, fontSize: 26 },
    duration: { color: t.bg, fontSize: t.fontCaption, marginTop: t.space1 },
    videoHint: { color: t.muted, fontSize: 10, marginTop: t.space1 },
  });
