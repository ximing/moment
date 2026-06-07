import { useEffect } from 'react';
import type { MomentMedia } from '@moment/dto';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';
import { Icon } from '@/ui/Icon';

export function Lightbox({
  items,
  index,
  shareToken,
  onClose,
  onIndex,
}: {
  items: MomentMedia[];
  index: number;
  shareToken?: string;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const current = items[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length);
      if (e.key === 'ArrowRight') onIndex((index + 1) % items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85" role="dialog" aria-modal>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] max-w-[90vw]">
        <LightboxMedia media={current} shareToken={shareToken} />
      </div>
      <button
        type="button"
        aria-label="关闭"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-sticker border-2 border-stroke bg-surface text-xl text-ink shadow-sticker"
        onClick={onClose}
      >
        <Icon icon={X} size={18} />
      </button>
      {items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="上一张"
            className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-sticker border-2 border-stroke bg-surface text-ink shadow-sticker"
            onClick={() => onIndex((index - 1 + items.length) % items.length)}
          >
            <Icon icon={ChevronLeft} size={22} />
          </button>
          <button
            type="button"
            aria-label="下一张"
            className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-sticker border-2 border-stroke bg-surface text-ink shadow-sticker"
            onClick={() => onIndex((index + 1) % items.length)}
          >
            <Icon icon={ChevronRight} size={22} />
          </button>
        </>
      )}
    </div>
  );
}

function LightboxMedia({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id);
  const url = shareToken ? `${media.url}?st=${encodeURIComponent(shareToken)}` : blobUrl;
  if (!url) return <div className="h-64 w-64 animate-pulse rounded bg-white/10" />;
  if (media.mime.startsWith('video/')) {
    return <video controls autoPlay src={url} className="max-h-[90vh] max-w-[90vw]" />;
  }
  return <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />;
}
