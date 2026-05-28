import { Image, StyleSheet, Text, View } from 'react-native';
import type { MomentMedia } from '@moment/dto';
import { useMediaUri } from '../lib/use-media-uri';

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

function MediaImage({ mediaId }: { mediaId: string }) {
  const uri = useMediaUri(mediaId);
  if (!uri) return <View style={styles.cell} />;
  return <Image source={{ uri }} style={styles.cell} resizeMode="cover" />;
}

export function MediaGrid({ media }: { media: MomentMedia[] }) {
  if (media.length === 0) return null;
  return (
    <View style={styles.grid}>
      {media.map((m) =>
        m.mime.startsWith('video/') ? (
          <View key={m.id} style={[styles.cell, styles.videoCell]}>
            <Text style={styles.play}>▶</Text>
            {m.duration != null && m.duration > 0 ? <Text style={styles.duration}>{formatDuration(m.duration)}</Text> : null}
            <Text style={styles.videoHint}>视频 · 进详情播放</Text>
          </View>
        ) : (
          <MediaImage key={m.id} mediaId={m.id} />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  cell: { width: '32%', aspectRatio: 1, borderRadius: 6, backgroundColor: '#eee' },
  videoCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#222' },
  play: { color: '#fff', fontSize: 26 },
  duration: { color: '#fff', fontSize: 12, marginTop: 4 },
  videoHint: { color: '#999', fontSize: 10, marginTop: 4 },
});
