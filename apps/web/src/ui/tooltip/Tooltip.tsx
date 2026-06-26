import type { ReactElement } from 'react';
import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { FloatingLayer } from '../floating/FloatingLayer';

// Tooltip（规范：docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md §9）
//
// 只解释图标或陌生控件的短纯文本：
// - label 只接受 string，浮面与 Trigger 都不写原生 title；
// - Trigger（如 IconButton）必须有独立可访问名称，Tooltip 只是描述关系；
// - fine pointer hover / focus 精确 600ms 打开，离开 / blur 精确 100ms 关闭；
// - Escape 关闭；点击不固定；coarse pointer 环境永不渲染；
// - 默认位于 Trigger 上方，裁剪时由 FloatingLayer 自动 Flip。
//
// 定位/Portal/碰撞由目录私有的 FloatingLayer 提供；Tooltip 不参与
// 外部点击关闭（hover/focus 生命周期自管），也不进入焦点。

/** hover 意图只在 fine pointer 下成立（规范 §9）。 */
function isCoarsePointer(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export type TooltipProps = {
  /** 简短纯文本，建议不超过 20 个中文字符（规范 §9） */
  label: string;
  /** 触发元素，必须有独立可访问名称（如 IconButton 的 label） */
  children: ReactElement;
};

export function Tooltip({ label, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentId = useId();
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  useEffect(() => clearTimers, []);

  // 固定 600ms / 100ms（规范 §9）；coarse pointer 永不调度
  const scheduleOpen = () => {
    if (isCoarsePointer()) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    openTimer.current = setTimeout(() => setOpen(true), 600);
  };
  const scheduleClose = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  };
  const closeNow = () => {
    clearTimers();
    setOpen(false);
  };

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-block"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        onPointerDown={closeNow}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            // 只消化 Tooltip 自己的关闭，不外溢到外层浮层
            event.stopPropagation();
            closeNow();
          }
        }}
      >
        {cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-describedby': open ? contentId : undefined,
        })}
      </span>
      <FloatingLayer
        open={open}
        onOpenChange={(next) => {
          if (!next) closeNow();
        }}
        triggerRef={anchorRef}
        nonModal
        dismissOnOutsidePress={false}
        placement="top"
        className="max-w-60 rounded-tooltip bg-tooltip-bg px-tooltip-x py-tooltip-y text-caption text-tooltip-fg z-tooltip transition-opacity duration-100 data-[entering]:opacity-0 data-[exiting]:opacity-0"
      >
        <div role="tooltip" id={contentId}>
          {label}
        </div>
      </FloatingLayer>
    </>
  );
}
