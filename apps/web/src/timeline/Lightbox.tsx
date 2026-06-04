import { useEffect } from 'react';
import type { MomentMedia } from '@moment/dto';
import { useMediaObjectUrl } from '@/media/useMediaObjectUrl';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90" role="dialog" aria-modal>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] max-w-[90vw]">
        <LightboxMedia media={current} shareToken={shareToken} />
      </div>
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="absolute left-4 z-10 text-2xl text-paper"
            onClick={() => onIndex((index - 1 + items.length) % items.length)}
          >
            ‹
          </button>
          <button
            type="button"
            className="absolute right-4 z-10 text-2xl text-paper"
            onClick={() => onIndex((index + 1) % items.length)}
          >
            ›
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
