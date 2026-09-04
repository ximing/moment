import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { MAX_AUDIO_DURATION_SECONDS } from '@moment/dto';
import { Button } from '../../components/Button';
import { toast } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import type { VoiceDraft } from './compose.service';

// 语音录制（spec voice-moment §6）：expo-audio useAudioRecorder（HIGH_QUALITY 预设 m4a/AAC，
// audio/mp4 在 dto 白名单内）；300s 自动停止；回听用 useAudioPlayer 播录音本地 uri。
// 权限拒绝走 Toast，不阻塞其他类型发布。

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

/** 回听：独立组件挂 useAudioPlayer（hook 不能条件调用） */
function ReplayButton({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  return (
    <Button
      variant="secondary"
      onPress={() => {
        void player.seekTo(0);
        player.play();
      }}
    >
      回听
    </Button>
  );
}

export function VoiceRecorder({
  voice,
  onChange,
}: {
  voice: VoiceDraft | null;
  onChange: (draft: VoiceDraft | null) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [busy, setBusy] = useState(false);
  const isStoppingRef = useRef(false);
  const isMountedRef = useRef(true);

  const elapsedSeconds = Math.floor((state.durationMillis ?? 0) / 1000);

  const stopRecording = useCallback(async () => {
    if (!state.isRecording || isStoppingRef.current) return;
    isStoppingRef.current = true;
    setBusy(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!isMountedRef.current) return;
      const uri = recorder.uri; // AudioRecorder 实例属性是 uri: string | null（url 在 RecorderState 上，实例无此属性）
      if (!uri) {
        onChange(null);
        return;
      }
      const file = new File(uri);
      onChange({
        uri,
        mime: 'audio/mp4',
        size: file.size ?? 0,
        durationSeconds: Math.max(1, Math.round((state.durationMillis ?? 0) / 1000)),
      });
    } catch (err) {
      isStoppingRef.current = false;
      throw err;
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  }, [onChange, recorder, state.durationMillis, state.isRecording]);

  // 300s 自动停止（spec §6，与 web 对齐）
  useEffect(() => {
    if (state.isRecording && (state.durationMillis ?? 0) >= MAX_AUDIO_DURATION_SECONDS * 1000) {
      void stopRecording();
    }
  }, [state.durationMillis, state.isRecording, stopRecording]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      void (async () => {
        try {
          if (recorder.getStatus().isRecording && !isStoppingRef.current) {
            isStoppingRef.current = true;
            await recorder.stop();
          }
        } catch {
          // 卸载时录音只丢弃，无 UI 可呈现错误。
        } finally {
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        }
      })();
    };
  }, [recorder]);

  const startRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!isMountedRef.current) return;
    if (!perm.granted) {
      toast.show({ key: 'voice', message: '麦克风权限被拒绝，请在系统设置中开启后再试' });
      return;
    }
    setBusy(true);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!isMountedRef.current) {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        return;
      }
      recorder.record();
      isStoppingRef.current = false;
    } catch {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      if (isMountedRef.current) toast.show({ key: 'voice', message: '录音启动失败，请重试' });
    } finally {
      if (isMountedRef.current) setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      {state.isRecording ? (
        <View style={styles.row}>
          <Button variant="secondary" loading={busy} onPress={() => void stopRecording()}>
            停止
          </Button>
          <Text style={styles.time}>
            {formatDuration(elapsedSeconds)} / {formatDuration(MAX_AUDIO_DURATION_SECONDS)}
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          <Button variant="secondary" loading={busy} onPress={() => void startRecording()}>
            {voice ? '重新录音' : '录音'}
          </Button>
          {voice ? <ReplayButton uri={voice.uri} /> : null}
          {voice ? (
            <Button variant="quiet" onPress={() => onChange(null)}>
              移除
            </Button>
          ) : null}
        </View>
      )}
      {voice && !state.isRecording ? (
        <Text style={styles.hint}>已录 {formatDuration(voice.durationSeconds)} · 发布后可修改转写文本</Text>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    box: { gap: t.space1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    time: { color: t.muted, fontSize: t.fontCaption },
    hint: { color: t.muted, fontSize: t.fontCaption },
  });
