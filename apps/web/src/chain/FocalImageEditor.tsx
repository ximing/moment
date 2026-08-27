import type { ChainImageFocus } from '@moment/dto';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useRef, useState } from 'react';
import { Button } from '@/ui/button/index';
import { focusObjectPosition, shiftFocusForDrag } from './appearance-model';

// FocalImageEditor（spec §7.4 / plan Task 7）：头像/封面共用的焦点编辑器。
// 拖动预览（pointer capture）+ 两个 label 明确的 range（0–100）作为键盘可访问
// 的等价操作；取消恢复进入前的初值，确认才把焦点回传给调用方。
// 只提交坐标——不生成 Blob、不二次上传。几何只用 4/8 网格与既有 semantic classes。

export interface FocalImageEditorProps {
  src: string;
  focus: ChainImageFocus;
  /** 场景标签（头像/封面），用于可访问名称；默认「头像」 */
  label?: string;
  /** 预览形态：circle = 圆形遮罩（头像），wide = 3:1 宽幅遮罩（封面） */
  variant?: 'circle' | 'wide';
  onConfirm(focus: ChainImageFocus): void;
  onCancel(): void;
}

function toRangeValue(value: number): number {
  return Math.round(value * 100);
}

function fromRangeValue(value: number): number {
  return value / 100;
}

export function FocalImageEditor({
  src,
  focus,
  label = '头像',
  variant = 'circle',
  onConfirm,
  onCancel,
}: FocalImageEditorProps) {
  const [draft, setDraft] = useState<ChainImageFocus>(focus);
  const previewRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startFocus: ChainImageFocus } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const preview = previewRef.current;
    if (!preview) return;
    preview.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startFocus: draft,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const preview = previewRef.current;
    const img = imgRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !preview || !img) return;
    const { naturalWidth, naturalHeight } = img;
    const { width, height } = preview.getBoundingClientRect();
    if (!naturalWidth || !naturalHeight || !width || !height) return;
    setDraft(
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
    previewRef.current?.releasePointerCapture(event.pointerId);
  };

  return (
    <div role="group" aria-label={`调整${label}位置`} className="space-y-3">
      <div
        ref={previewRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`touch-none overflow-hidden bg-field-bg ${
          variant === 'circle'
            ? 'mx-auto h-32 w-32 rounded-full'
            : 'aspect-[3/1] w-full rounded-surface-md'
        }`}
      >
        <img
          ref={imgRef}
          src={src}
          alt="位置预览"
          draggable={false}
          className="h-full w-full object-cover"
          style={{ objectPosition: focusObjectPosition(draft) }}
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-3 text-meta text-muted">
          <span className="shrink-0">水平位置</span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="水平位置"
            value={toRangeValue(draft.x)}
            onChange={(event) =>
              setDraft((d) => ({ ...d, x: fromRangeValue(Number(event.target.value)) }))
            }
            className="min-w-0 flex-1 accent-[var(--action)] focus-visible:outline-none focus-visible:ring-focus"
          />
        </label>
        <label className="flex items-center gap-3 text-meta text-muted">
          <span className="shrink-0">垂直位置</span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="垂直位置"
            value={toRangeValue(draft.y)}
            onChange={(event) =>
              setDraft((d) => ({ ...d, y: fromRangeValue(Number(event.target.value)) }))
            }
            className="min-w-0 flex-1 accent-[var(--action)] focus-visible:outline-none focus-visible:ring-focus"
          />
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="quiet"
          onClick={() => {
            // 取消：恢复进入编辑器前的坐标，再交还控制权
            setDraft(focus);
            onCancel();
          }}
        >
          取消
        </Button>
        <Button variant="primary" onClick={() => onConfirm(draft)}>
          确认
        </Button>
      </div>
    </div>
  );
}
