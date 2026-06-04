import { useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { useMediaObjectUrl } from './useMediaObjectUrl';

function srcOf(m: MomentMedia, shareToken?: string): string {
  if (shareToken) return `${m.url}?st=${encodeURIComponent(shareToken)}`;
  return '';
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
  const cols = media.length === 1 ? 'grid-cols-1' : media.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className={`mt-3 grid ${cols} gap-1`}>
      {media.map((m, i) => (
        <ImageOne
          key={m.id}
          media={m}
          shareToken={shareToken}
          single={media.length === 1}
          onClick={() => onOpen?.(i)}
        />
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
  single: boolean;
  onClick?: () => void;
}) {
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id);
  const url = shareToken ? srcOf(media, shareToken) : blobUrl;
  if (!url) return <div className={`animate-pulse rounded-paper bg-line ${single ? 'aspect-[4/3]' : 'aspect-square'}`} />;
  return (
    <button type="button" onClick={onClick} className="block overflow-hidden rounded-paper">
      <img
        src={url}
        alt=""
        className={single ? 'max-h-[28rem] w-full object-contain' : 'aspect-square w-full object-cover'}
      />
    </button>
  );
}

function VideoOne({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
  const [on, setOn] = useState(Boolean(shareToken));
  const blobUrl = useMediaObjectUrl(!shareToken && on ? media.id : null);
  const url = shareToken ? srcOf(media, shareToken) : blobUrl;
  if (!on) {
    return (
      <button
        type="button"
        onClick={() => setOn(true)}
        className="mt-3 flex aspect-video w-full items-center justify-center rounded-paper bg-ink text-sm text-paper"
      >
        播放视频
      </button>
    );
  }
  if (!url) return <div className="mt-3 aspect-video w-full animate-pulse rounded-paper bg-line" />;
  return <video controls src={url} className="mt-3 w-full rounded-paper bg-ink" />;
}
