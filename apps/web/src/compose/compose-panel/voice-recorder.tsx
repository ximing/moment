import { useEffect, useRef, useState } from 'react';
import { MAX_AUDIO_DURATION_SECONDS } from '@moment/dto';
import { Mic, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/ui/button';
import { Banner } from '@/ui/feedback/index';
import { recorderBlobToWav } from '@/lib/audio-wav';

// 语音录制（spec voice-moment §5）：MediaRecorder 采集 → 停止后转 16kHz mono WAV（audio-wav.ts），
// 300s 自动停止；回听用转码后 WAV 的 object URL（与实际上传产物一致）。
// previewUrl 所有权随 onChange 转移给 service（resetVoice/clearPreviews 统一 revoke）；
// 重录（reset）由组件先 revoke 自己创建的 URL，service.setVoice(null) 的再次 revoke 是无害 no-op。

export interface VoiceDraft {
  blob: Blob;
  durationSeconds: number;
  previewUrl: string;
}

function formatRecordTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

export function VoiceRecorder({ onChange }: { onChange: (draft: VoiceDraft | null) => void }) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'done'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 每次 start 都分配递增 token。reset/卸载使旧 token 失效；任何 await 后都只能回写仍活跃的会话。
  const mountedRef = useRef(true);
  const sessionRef = useRef(0);
  const recordingRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; token: number } | null>(null);
  const timerRef = useRef<{ id: number; token: number } | null>(null);
  const previewRef = useRef<string | null>(null);

  const isActive = (token: number) => mountedRef.current && sessionRef.current === token;

  const clearTimer = (token?: number) => {
    if (timerRef.current !== null && (token === undefined || timerRef.current.token === token)) {
      window.clearInterval(timerRef.current.id);
      timerRef.current = null;
    }
  };

  // reset/卸载必须同时关闭 recorder 与麦克风 tracks；其异步 onstop 由旧 token 拦截。
  const stopActiveCapture = () => {
    const active = recordingRef.current;
    recordingRef.current = null;
    if (!active) return;
    if (active.recorder.state === 'recording') active.recorder.stop();
    active.stream.getTracks().forEach((track) => track.stop());
  };

  const stop = (token = sessionRef.current) => {
    const active = recordingRef.current;
    if (active?.token === token && active.recorder.state === 'recording') active.recorder.stop();
  };

  const start = async () => {
    // 先失效旧会话，再请求权限；并发 start 的较早 getUserMedia resolve 也只能自行释放 tracks。
    const token = sessionRef.current + 1;
    let stream: MediaStream | null = null;
    sessionRef.current = token;
    stopActiveCapture();
    clearTimer();
    setError(null);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isActive(token)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const activeStream = stream;
      const recorder = new MediaRecorder(activeStream);
      const chunks: Blob[] = [];
      recordingRef.current = { recorder, stream: activeStream, token };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        activeStream.getTracks().forEach((t) => t.stop());
        if (recordingRef.current?.recorder === recorder) recordingRef.current = null;
        clearTimer(token); // 不能让旧 onstop 清掉新会话的 timer
        if (!isActive(token)) return;
        const raw = new Blob(chunks, { type: recorder.mimeType });
        void recorderBlobToWav(raw)
          .then(({ blob, durationSeconds }) => {
            // 转码期间 reset/卸载则既不建 object URL，也不触发 service 回写。
            if (!isActive(token)) return;
            const url = URL.createObjectURL(blob);
            previewRef.current = url;
            setPreviewUrl(url);
            setPhase('done');
            onChange({ blob, durationSeconds, previewUrl: url });
          })
          .catch(() => {
            // 失败也不能覆盖已经开始的新会话或已关闭的面板。
            if (!isActive(token)) return;
            setError('无法处理录音，请重试');
            setPhase('idle');
            onChange(null);
          });
      };
      recorder.start();
      setElapsed(0);
      setPhase('recording');
      const startedAt = Date.now();
      timerRef.current = { id: window.setInterval(() => {
        if (!isActive(token)) {
          clearTimer(token);
          return;
        }
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(sec);
        if (sec >= MAX_AUDIO_DURATION_SECONDS) stop(token); // 300s 自动停止（spec §5）
      }, 250), token };
    } catch {
      // getUserMedia 的拒绝/异常若属于失效会话，禁止对已关闭 service 回写。
      if (!isActive(token)) return;
      // MediaRecorder 构造/start 抛错时，也先使 token 失效，防止 stop() 随后触发的 onstop 转码回写。
      sessionRef.current += 1;
      clearTimer(token);
      if (recordingRef.current?.token === token) {
        stopActiveCapture();
      } else {
        stream?.getTracks().forEach((track) => track.stop());
      }
      setError('麦克风不可用或权限被拒绝');
      onChange(null);
    }
  };

  const reset = () => {
    // 重录：丢弃未上传草稿；已上传未绑定的 audio 行按既有 ready-unbound gap 处理（spec §5，本期不新增清理）
    sessionRef.current += 1; // 先取消 onstop / 转码 / getUserMedia 的全部后续回写
    clearTimer();
    stopActiveCapture();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setElapsed(0);
    setPhase('idle');
    onChange(null);
  };

  // 卸载清理：先取消会话，再停 recorder、麦克风 tracks 与 timer；已交给 service 的 previewUrl 不在此 revoke。
  useEffect(
    () => {
      // React Strict Mode 的 effect 重放后恢复 mounted 标志。
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        sessionRef.current += 1;
        clearTimer();
        stopActiveCapture();
      };
    },
    []
  );

  return (
    <div className="flex flex-col gap-2">
      {error && <Banner tone="error">{error}</Banner>}
      {phase === 'idle' && (
        <div>
          <Button variant="secondary" leadingIcon={Mic} onClick={() => void start()}>
            录音
          </Button>
        </div>
      )}
      {phase === 'recording' && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" leadingIcon={Square} onClick={() => stop()}>
            停止
          </Button>
          <span className="text-meta text-muted">
            {formatRecordTime(elapsed)} / {formatRecordTime(MAX_AUDIO_DURATION_SECONDS)}
          </span>
        </div>
      )}
      {phase === 'done' && previewUrl && (
        <div className="flex flex-col gap-2">
          <audio src={previewUrl} controls className="w-full" />
          <div>
            <Button variant="quiet" leadingIcon={RotateCcw} onClick={reset}>
              重录
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
