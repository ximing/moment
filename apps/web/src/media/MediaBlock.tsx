import { useState } from 'react';
import type { MomentMedia } from '@moment/dto';
import { Play } from 'lucide-react';
import { Icon } from '@/ui/Icon';
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
  if (media.length === 1) {
    return (
      <div className="elev overflow-hidden rounded-[20px] bg-[color:color-mix(in_srgb,var(--line)_55%,var(--surface))]">
        <ImageOne media={media[0]!} shareToken={shareToken} single onClick={() => onOpen?.(0)} />
      </div>
    );
  }
  const cols = media.length <= 3 ? media.length : 3;
  const grid = cols === 2 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className={`elev grid ${grid} gap-[3px] overflow-hidden rounded-[20px] bg-[color:color-mix(in_srgb,var(--line)_55%,var(--surface))]`}>
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
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id);
  const url = shareToken ? srcOf(media, shareToken) : blobUrl;
  if (!url) return <div className={`animate-pulse bg-line ${single ? 'aspect-[4/3]' : 'aspect-square'}`} />;
  return (
    <button type="button" onClick={onClick} className="block w-full overflow-hidden">
      <img
        src={url}
        alt=""
        className={single ? 'block h-auto max-h-[430px] w-full object-cover' : 'block aspect-square w-full object-cover'}
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
        className="elev relative aspect-video w-full overflow-hidden rounded-[20px] bg-ink"
      >
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-action text-xl text-action-fg shadow-fab">
            <Icon icon={Play} size={22} className="ml-0.5 fill-current" />
          </span>
        </span>
      </button>
    );
  }
  if (!url) return <div className="aspect-video w-full animate-pulse rounded-[20px] bg-line" />;
  return <video controls src={url} className="elev w-full rounded-[20px] bg-ink" />;
}
