import { useRef, useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { Pause, Play } from 'lucide-react';
import { originalDisplayUrl } from '@/lib/media-src';
import { Icon } from '@/ui/Icon';

// 语音播放条（spec voice-moment §5）：播放/暂停 + 进度条 + 时长；v1 不渲染波形（spec §0 搁置决策）。
// 直出接口签发的预签名 GET。
// 视觉只消费 token：rounded-surface-md / bg-surface / bg-action / text-action-fg / text-meta / text-muted。

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? `0${s}` : `${s}`}`;
}

export function AudioBar({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
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

  return (
    <div className="flex items-center gap-3 rounded-surface-md bg-surface px-3 py-2">
      {url && (
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
      )}
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
