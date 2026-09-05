import { useRef, useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { Play } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { cardDisplayUrl, originalDisplayUrl, posterDisplayUrl } from '@/lib/media-src';

// 时刻媒体块（C 端总规范 §6.1 / §10）：0/1/2–9/视频都是一等分支。
// 0 → 无媒体 DOM；1 图按固有像素宽显示，最大不超过内容列（max-w-full）；
// 2 图两列、3–9 图三列方形格，点击回报被点 index；
// 视频：封面 overlay 盖在 preload=none 的 <video> 上，同一次点击里 play()，
// playing 后再露原生 controls（避免点两次、封面先卸成黑场）。
// 卡片优先 derivedUrl，灯箱/播放用 url；均为接口签发的预签名 GET，直出。

/* ---------------------------------------------------------------------------
 * 媒体加载占位动效：与 Feedback Skeleton 同构的低对比呼吸（--skeleton-cycle）。
 * Feedback 的 keyframes 是其目录私有实现，这里独立命名自携；reduced-motion
 * 下重定义 keyframes 为静态（同 moment-toast-in 的覆写手法）。Tailwind 配置
 * 由 Task 2 锁定，动画类走 arbitrary value。lightbox 复用同一份。
 * ------------------------------------------------------------------------- */
export const mediaSkeletonClass =
  'animate-[moment-media-skeleton_var(--skeleton-cycle)_ease-in-out_infinite]';

export function MediaSkeletonStyles() {
  return (
    <style>{`
@keyframes moment-media-skeleton {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes moment-media-skeleton {
    0%, 100% { opacity: 1; }
  }
}
`}</style>
  );
}

export function MediaBlock({
  media,
  shareToken,
  onOpen,
}: {
  media: MomentMedia[];
  shareToken?: string;
  onOpen?: (index: number) => void;
}) {
  if (media.length === 0) return null;
  return (
    <>
      <MediaSkeletonStyles />
      {media[0]!.mime.startsWith('video/') ? (
        <VideoOne media={media[0]!} shareToken={shareToken} />
      ) : media.length === 1 ? (
        <div className="w-fit max-w-full overflow-hidden">
          <ImageOne media={media[0]!} shareToken={shareToken} single onClick={() => onOpen?.(0)} />
        </div>
      ) : (
        <div
          className={`grid ${media.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-1 overflow-hidden`}
        >
          {media.map((m, i) => (
            <ImageOne key={m.id} media={m} shareToken={shareToken} onClick={() => onOpen?.(i)} />
          ))}
        </div>
      )}
    </>
  );
}

function ImageSkeleton({
  single,
  width,
  height,
}: {
  single?: boolean;
  width?: number | null;
  height?: number | null;
}) {
  if (single && width && height) {
    return (
      <div
        data-media-skeleton
        aria-hidden
        className={`w-full max-w-full bg-feedback-skeleton ${mediaSkeletonClass}`}
        style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }}
      />
    );
  }
  return (
    <div
      data-media-skeleton
      aria-hidden
      className={`bg-feedback-skeleton ${mediaSkeletonClass} ${single ? 'aspect-video' : 'aspect-square'}`}
    />
  );
}

function PendingImg({
  src,
  single,
  width,
  height,
}: {
  src: string;
  single?: boolean;
  width?: number | null;
  height?: number | null;
}) {
  const [ready, setReady] = useState(false);
  return (
    <span className={`relative block overflow-hidden ${single ? 'w-fit max-w-full' : 'aspect-square w-full'}`}>
      {!ready ? (
        <span className="absolute inset-0">
          <ImageSkeleton single={single} width={width} height={height} />
        </span>
      ) : null}
      {single ? (
        <img
          src={src}
          alt=""
          width={width ?? undefined}
          height={height ?? undefined}
          onLoad={() => setReady(true)}
          onError={() => setReady(true)}
          className={`block h-auto max-w-full ${ready ? '' : 'opacity-0'}`}
        />
      ) : (
        <img
          src={src}
          alt=""
          onLoad={() => setReady(true)}
          onError={() => setReady(true)}
          className={`block aspect-square w-full object-cover ${ready ? '' : 'opacity-0'}`}
        />
      )}
    </span>
  );
}

function ImageOne({
  media,
  shareToken,
  single,
  onClick,
}: {
  media: MomentMedia;
  shareToken?: string;
  single?: boolean;
  onClick?: () => void;
}) {
  const url = cardDisplayUrl(media, shareToken);
  if (!url) {
    return <ImageSkeleton single={single} width={media.width} height={media.height} />;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block overflow-hidden border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset ${single ? 'max-w-full' : 'w-full'}`}
    >
      <PendingImg src={url} single={single} width={media.width} height={media.height} />
    </button>
  );
}

function VideoOne({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const posterUrl = posterDisplayUrl(media, shareToken);
  const url = originalDisplayUrl(media, shareToken);
  if (!url) {
    return (
      <div
        data-media-skeleton
        aria-hidden
        className={`aspect-video w-full bg-feedback-skeleton ${mediaSkeletonClass}`}
      />
    );
  }

  const start = () => {
    const el = videoRef.current;
    if (!el) return;
    // 必须在同一次用户手势里调 play()：setState 后再 effect 会被 Safari 拦未静音自动播放。
    const playing = el.play();
    if (playing !== undefined) void playing.catch(() => undefined);
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-ink">
      <video
        ref={videoRef}
        src={url}
        poster={posterUrl ?? undefined}
        preload="none"
        playsInline
        controls={started}
        className="h-full w-full bg-ink"
        onPlaying={() => setStarted(true)}
      />
      {!started && (
        <button
          type="button"
          aria-label="播放视频"
          onClick={start}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
        >
          {posterUrl && (
            <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-action text-action-fg">
              <Icon icon={Play} size={20} className="ml-0.5 fill-current" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
