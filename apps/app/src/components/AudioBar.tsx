import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { MomentMedia } from '@moment/dto';
import { isHttpUrl, originalDisplayUrl } from '../lib/media-src';
import { useMediaUri } from '../lib/use-media-uri';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

// 语音播放条（spec voice-moment §6）：播放/暂停 + 进度/时长；v1 无波形（spec §0 搁置）。
// 优先接口签发的 https 预签名 GET；相对路径才经 useMediaUri 拉本地缓存（原生播放器不带鉴权头）。

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

/** 播放器：独立组件挂 useAudioPlayer（uri 未到时不挂 hook） */
function Player({ media, uri }: { media: MomentMedia; uri: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);
  // 行上 duration（presign 上报值）兜底：播放器元数据未就绪时进度分母不为 0
  const duration = status.duration > 0 ? status.duration : (media.duration ?? 0);
  const currentTime = Math.min(status.currentTime, duration);
  const progress = duration > 0 ? currentTime / duration : 0;

  const seek = async (locationX: number) => {
    if (duration <= 0 || trackWidth <= 0) return;
    const next = Math.max(0, Math.min(duration, (locationX / trackWidth) * duration));
    await player.seekTo(next);
  };

  const onTrackLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const togglePlayback = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish) await player.seekTo(0);
    player.play();
  };

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityLabel={status.playing ? '暂停语音' : '播放语音'}
        hitSlop={t.space2}
        onPress={() => void togglePlayback()}
        style={styles.playBtn}
      >
        <Text style={styles.playIcon}>{status.playing ? '⏸' : '▶'}</Text>
      </Pressable>
      <Text style={styles.time}>
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </Text>
      <Pressable
        accessibilityLabel="语音播放进度"
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: duration, now: currentTime }}
        hitSlop={t.space2}
        onLayout={onTrackLayout}
        onPress={(event) => void seek(event.nativeEvent.locationX)}
        style={styles.trackHitbox}
      >
        <View style={styles.trackRail}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

export function AudioBar({ media }: { media: MomentMedia }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const signed = originalDisplayUrl(media);
  const fetched = useMediaUri(isHttpUrl(signed) ? undefined : media.id);
  const uri = isHttpUrl(signed) ? signed : fetched;
  if (!uri) return <View style={styles.bar} />;
  return <Player media={media} uri={uri} />;
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      borderRadius: t.radiusMd,
      padding: t.space2,
      marginTop: t.space2,
    },
    playBtn: { minWidth: t.touchMin, minHeight: t.touchMin, alignItems: 'center', justifyContent: 'center' },
    playIcon: { color: t.ink, fontSize: t.fontBody },
    time: { color: t.muted, fontSize: t.fontCaption },
    trackHitbox: { flex: 1, minHeight: t.touchMin, justifyContent: 'center' },
    trackRail: { height: t.space1, borderRadius: t.radiusMd, overflow: 'hidden', backgroundColor: t.line },
    trackFill: { height: '100%', backgroundColor: t.action },
  });
