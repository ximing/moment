import { useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { Play } from 'lucide-react';
import { client } from '@/api/client';
import { Icon } from '@/ui/Icon';
import { useMediaObjectUrl } from './useMediaObjectUrl';

// 时刻媒体块（C 端总规范 §6.1 / §10）：0/1/2–9/视频都是一等分支。
// 0 → 无媒体 DOM；1 图按声明宽高渲染（width/height 属性给出固有比例，现代浏览器
// 由此推导 aspect-ratio）；2 图两列、3–9 图三列方形格，点击回报被点 index；
// 视频先 16:9 播放面、点后出原生 controls。认证卡片优先 derived；分享走
// `client.mediaUrl`（已有 `?` 则 `&st=`）。视觉只消费 token：rounded-surface-lg
// 媒体圆角、bg-feedback-skeleton 加载占位、bg-ink 播放面底色、ring-focus 焦点环。

function cardVariant(media: Pick<MomentMedia, 'derivedUrl'>): 'original' | 'derived' {
  return media.derivedUrl ? 'derived' : 'original';
}

function posterVariant(media: Pick<MomentMedia, 'posterDerivedUrl'>): 'original' | 'derived' {
  return media.posterDerivedUrl ? 'derived' : 'original';
}

function shareSrc(mediaId: string, shareToken: string, variant?: 'original' | 'derived'): string {
  return client.mediaUrl(mediaId, {
    variant: variant === 'derived' ? 'derived' : undefined,
    st: shareToken,
  });
}

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
  if (media[0]!.mime.startsWith('video/')) {
    return <VideoOne media={media[0]!} shareToken={shareToken} />;
  }
  if (media.length === 1) {
    return (
      <div className="overflow-hidden rounded-surface-lg">
        <ImageOne media={media[0]!} shareToken={shareToken} single onClick={() => onOpen?.(0)} />
      </div>
    );
  }
  return (
    <div
      className={`grid ${media.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-1 overflow-hidden rounded-surface-lg`}
    >
      {media.map((m, i) => (
        <ImageOne key={m.id} media={m} shareToken={shareToken} onClick={() => onOpen?.(i)} />
      ))}
    </div>
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
  const variant = cardVariant(media);
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id, {
    variant,
    fallbackToOriginal: variant === 'derived',
  });
  const url = shareToken ? shareSrc(media.id, shareToken, variant) : blobUrl;
  if (!url) {
    // 加载占位只消费 --feedback-skeleton；单图按声明宽高占位，多图按方形格
    return (
      <>
        <MediaSkeletonStyles />
        {single && media.width && media.height ? (
          <div
            aria-hidden
            className={`w-full bg-feedback-skeleton ${mediaSkeletonClass}`}
            style={{ aspectRatio: `${media.width} / ${media.height}` }}
          />
        ) : (
          <div
            aria-hidden
            className={`bg-feedback-skeleton ${mediaSkeletonClass} ${single ? 'aspect-video' : 'aspect-square'}`}
          />
        )}
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset"
    >
      {single ? (
        // 声明宽高比：width/height 属性即固有比例，w-full h-auto 让浏览器保比缩放
        <img
          src={url}
          alt=""
          width={media.width ?? undefined}
          height={media.height ?? undefined}
          className="block h-auto w-full"
        />
      ) : (
        <img src={url} alt="" className="block aspect-square w-full object-cover" />
      )}
    </button>
  );
}

function VideoOne({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
  const [on, setOn] = useState(Boolean(shareToken));
  const blobUrl = useMediaObjectUrl(!shareToken && on ? media.id : null, {
    variant: 'original',
    fallbackToOriginal: false,
  });
  const pVariant = posterVariant(media);
  const posterBlobUrl = useMediaObjectUrl(!shareToken && !on ? media.posterMediaId : null, {
    variant: pVariant,
    fallbackToOriginal: pVariant === 'derived',
  });
  const url = shareToken ? shareSrc(media.id, shareToken) : blobUrl;
  if (!on) {
    return (
      <button
        type="button"
        aria-label="播放视频"
        onClick={() => setOn(true)}
        className="relative aspect-video w-full overflow-hidden rounded-surface-lg bg-ink focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
      >
        {posterBlobUrl && (
          <img src={posterBlobUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-action text-action-fg">
            <Icon icon={Play} size={20} className="ml-0.5 fill-current" />
          </span>
        </span>
      </button>
    );
  }
  if (!url) {
    return (
      <>
        <MediaSkeletonStyles />
        <div
          aria-hidden
          className={`aspect-video w-full rounded-surface-lg bg-feedback-skeleton ${mediaSkeletonClass}`}
        />
      </>
    );
  }
  return (
    <video
      controls
      src={url}
      poster={
        shareToken && media.posterMediaId
          ? shareSrc(media.posterMediaId, shareToken, pVariant)
          : undefined
      }
      className="aspect-video w-full rounded-surface-lg bg-ink"
    />
  );
}
