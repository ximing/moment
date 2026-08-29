import { useEffect } from 'react';
import type { MomentMedia } from '@moment/dto';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { originalDisplayUrl } from '@/lib/media-src';
import { MediaSkeletonStyles, mediaSkeletonClass } from '@/media/MediaBlock';
import { IconButton } from '@/ui/button/index';

// 灯箱（Task 11）：受控 index，上一张/下一张按钮与 ArrowLeft/ArrowRight 都环绕；
// Escape、点媒体外空白（遮罩本身）、具名「关闭」IconButton 都走 onClose；
// 单张隐藏前后箭头。层级与焦点走 Task 4 规则：z-lightbox token、IconButton 自带
// ring-focus。详情用接口签发的原图 url（非 derived）。

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="媒体预览"
      className="fixed inset-0 z-lightbox flex items-center justify-center bg-[color:color-mix(in_srgb,var(--ink)_88%,transparent)]"
      onClick={(e) => {
        // 点媒体外空白关闭：只有落在遮罩本身才算，内容与按钮的冒泡不算
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] max-w-[90vw]">
        <LightboxMedia media={current} shareToken={shareToken} />
      </div>
      <IconButton icon={X} label="关闭" className="absolute right-4 top-4" onClick={onClose} />
      {items.length > 1 && (
        <>
          <IconButton
            icon={ChevronLeft}
            label="上一张"
            className="absolute left-4 top-1/2 -translate-y-1/2"
            onClick={() => onIndex((index - 1 + items.length) % items.length)}
          />
          <IconButton
            icon={ChevronRight}
            label="下一张"
            className="absolute right-4 top-1/2 -translate-y-1/2"
            onClick={() => onIndex((index + 1) % items.length)}
          />
        </>
      )}
    </div>
  );
}

function LightboxMedia({ media, shareToken }: { media: MomentMedia; shareToken?: string }) {
  const url = originalDisplayUrl(media, shareToken);
  if (!url) {
    // 加载占位与 MediaBlock 同一呼吸动效（reduced-motion 静态化），保持骨架语言一致
    return (
      <>
        <MediaSkeletonStyles />
        <div
          aria-hidden
          className={`h-64 w-64 rounded-surface-md bg-[color:color-mix(in_srgb,var(--bg)_12%,transparent)] ${mediaSkeletonClass}`}
        />
      </>
    );
  }
  if (media.mime.startsWith('video/')) {
    return <video controls autoPlay src={url} className="max-h-[90vh] max-w-[90vw]" />;
  }
  return <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />;
}
