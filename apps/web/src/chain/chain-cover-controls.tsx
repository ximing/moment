import { observer, useService } from '@rabjs/react';
import type { ChainImageFocus } from '@moment/dto';
import type { LucideIcon } from 'lucide-react';
import { Image as ImageIcon, Move, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChainHomeService } from '@/pages/chain-home/chain-home.service';
import { Button } from '@/ui/button/index';
import { Icon } from '@/ui/Icon';
import { InlineProgress } from '@/ui/feedback/index';
import { CENTER_FOCUS, shiftFocusForDrag } from './appearance-model';
import { ChainCover } from './ChainCover';

// 链首页封面的 Notion 式入口：更换 / 调整位置 / 去掉；调整时在封面上拖动。
// owner 才渲染。平板始终露出控件，宽屏悬停才显示（无 hover 的设备除外）。
// 拖动预览走组件本地 state：每帧写 Service 会把整页 observer 打满，看起来像拖不动。

const CHIP = 'z-10 flex flex-wrap items-center rounded-full bg-surface px-1 py-1';
const HOVER_REVEAL =
  'opacity-100 min-[1400px]:opacity-0 min-[1400px]:group-hover:opacity-100 min-[1400px]:focus-within:opacity-100 [@media(hover:none)]:opacity-100';
const CHIP_ACTION =
  'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-meta text-ink transition-colors duration-[var(--ease)] hover:bg-floating-hover focus-visible:outline-none focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-button-disabled';
const CHIP_PRIMARY =
  'inline-flex shrink-0 items-center rounded-full bg-action px-2 py-1 text-meta text-action-fg transition-colors duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--action)_94%,var(--ink))] focus-visible:outline-none focus-visible:ring-focus';

function CoverChipButton({
  icon,
  children,
  disabled,
  variant = 'quiet',
  onClick,
}: {
  icon?: LucideIcon;
  children: string;
  disabled?: boolean;
  variant?: 'quiet' | 'primary';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={variant === 'primary' ? CHIP_PRIMARY : CHIP_ACTION}
    >
      {icon ? <Icon icon={icon} /> : null}
      {children}
    </button>
  );
}

export const EditableChainCover = observer(function EditableChainCover({
  mediaId,
  src,
  focus,
  onError,
}: {
  mediaId: string;
  src?: string | null;
  focus: ChainImageFocus | null;
  onError?: () => void;
}) {
  const service = useService(ChainHomeService);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startFocus: ChainImageFocus;
  } | null>(null);
  const [draftFocus, setDraftFocus] = useState<ChainImageFocus | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const liveFocus = service.repositioning
    ? (draftFocus ?? service.repositionFocus ?? focus)
    : focus;
  const busy = service.coverBusy;

  useEffect(() => {
    setDraftFocus(null);
    setGrabbing(false);
  }, [mediaId]);

  useEffect(() => {
    if (!service.repositioning) {
      setDraftFocus(null);
      setGrabbing(false);
    }
  }, [service.repositioning]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!service.repositioning || event.button !== 0) return;
    const preview = previewRef.current;
    if (!preview) return;
    event.preventDefault();
    preview.setPointerCapture(event.pointerId);
    const startFocus = draftFocus ?? service.repositionFocus ?? focus ?? CENTER_FOCUS;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFocus,
    };
    setGrabbing(true);
    setDraftFocus(startFocus);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const preview = previewRef.current;
    const img = preview?.querySelector('img');
    if (!drag || drag.pointerId !== event.pointerId || !preview || !img) return;
    const { naturalWidth, naturalHeight } = img;
    const { width, height } = preview.getBoundingClientRect();
    if (!naturalWidth || !naturalHeight || !width || !height) return;
    setDraftFocus(
      shiftFocusForDrag(
        drag.startFocus,
        { deltaX: event.clientX - drag.startX, deltaY: event.clientY - drag.startY },
        {
          imageWidth: naturalWidth,
          imageHeight: naturalHeight,
          viewportWidth: width,
          viewportHeight: height,
        },
      ),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setGrabbing(false);
    previewRef.current?.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="group relative">
      <div
        ref={previewRef}
        className={
          service.repositioning
            ? `select-none touch-none ${grabbing ? 'cursor-grabbing' : 'cursor-grab'}`
            : undefined
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <ChainCover mediaId={mediaId} src={src} focus={liveFocus} onError={onError} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        aria-label="选择封面图片"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void service.replaceCover(file);
          event.target.value = '';
        }}
      />
      {busy ? (
        <div className="absolute inset-x-0 bottom-3 z-10 px-3">
          <InlineProgress variant="indeterminate" label="正在更新封面" />
        </div>
      ) : service.repositioning ? (
        <>
          <p className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit rounded-full bg-surface px-3 py-1 text-meta text-muted">
            拖动封面，调整显示位置
          </p>
          <div className={`absolute bottom-3 right-3 ${CHIP}`}>
            <CoverChipButton onClick={() => service.cancelReposition()}>取消</CoverChipButton>
            <CoverChipButton
              variant="primary"
              onClick={() => void service.saveReposition(draftFocus ?? service.repositionFocus ?? undefined)}
            >
              保存位置
            </CoverChipButton>
          </div>
        </>
      ) : (
        <div className={`absolute bottom-3 left-3 ${CHIP} ${HOVER_REVEAL}`}>
          <CoverChipButton icon={ImageIcon} disabled={busy} onClick={() => fileRef.current?.click()}>
            更换封面
          </CoverChipButton>
          <CoverChipButton icon={Move} disabled={busy} onClick={() => service.startReposition()}>
            调整位置
          </CoverChipButton>
          <CoverChipButton icon={X} disabled={busy} onClick={() => void service.removeCover()}>
            去掉封面
          </CoverChipButton>
        </div>
      )}
    </div>
  );
});

export const AddCoverButton = observer(function AddCoverButton() {
  const service = useService(ChainHomeService);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mb-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        aria-label="选择封面图片"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void service.replaceCover(file);
          event.target.value = '';
        }}
      />
      <Button
        variant="quiet"
        leadingIcon={ImageIcon}
        disabled={service.coverBusy}
        onClick={() => fileRef.current?.click()}
      >
        添加封面
      </Button>
    </div>
  );
});
