import { useRef, useState, type ReactNode } from 'react';
import type { MomentMedia } from '@moment/dto';
import { Pause, Play } from 'lucide-react';
import { originalDisplayUrl } from '@/lib/media-src';
import { Icon } from '@/ui/Icon';

// 语音播放条（spec voice-moment §5）：control = 播放/暂停 + 进度条 + 时长（详情/发布）。
// 相册 variant=note 走作者头像 + 波形条，不渲染 range。
// 直出接口签发的预签名 GET。

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

export function AudioBar({
  media,
  shareToken,
  variant = 'control',
  face,
}: {
  media: MomentMedia;
  shareToken?: string;
  variant?: 'control' | 'note';
  face?: ReactNode;
}) {
  const url = originalDisplayUrl(media, shareToken);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // 初始时长用行上 duration（presign 上报值），loadedmetadata 后换真实值
  const [duration, setDuration] = useState(media.duration ?? 0);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      void el.play();
    }
  };

  const audioEl = url ? (
    <audio
      ref={audioRef}
      src={url}
      preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => {
        setPlaying(false);
        setPosition(0);
      }}
      onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
    />
  ) : null;

  if (variant === 'note') {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    return (
      <div className="moment-note-voice">
        {audioEl}
        <button
          type="button"
          aria-label={playing ? '暂停语音' : '播放语音'}
          disabled={!url}
          onClick={toggle}
          className="moment-note-voice-play text-caption focus-visible:outline-none focus-visible:ring-focus disabled:opacity-50"
        >
          {face}
        </button>
        <span className="moment-note-voice-wave" aria-hidden>
          <i style={{ ['--p' as string]: `${pct}%` }} />
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-surface-md bg-surface px-3 py-2">
      {audioEl}
      <button
        type="button"
        aria-label={playing ? '暂停语音' : '播放语音'}
        disabled={!url}
        onClick={toggle}
        className="grid h-10 w-10 min-h-touch-control min-w-[var(--touch-control-min)] shrink-0 place-items-center rounded-full bg-action text-action-fg focus-visible:outline-none focus-visible:ring-focus disabled:opacity-50"
      >
        <Icon icon={playing ? Pause : Play} size={16} className={playing ? '' : 'ml-0.5 fill-current'} />
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.1}
        value={Math.min(position, duration || 0)}
        aria-label="语音进度"
        onChange={(e) => {
          const t = Number(e.target.value);
          if (audioRef.current) audioRef.current.currentTime = t;
          setPosition(t);
        }}
        className="min-w-0 flex-1"
      />
      <span className="shrink-0 text-meta text-muted">
        {formatDuration(position)} / {formatDuration(duration)}
      </span>
    </div>
  );
}
