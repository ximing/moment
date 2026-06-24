import { REACTION_EMOJIS } from '@moment/dto';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { FloatingLayer } from '../floating/FloatingLayer';

// Popover 家族（规范：docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md §8）
//
// Popover 是锚定的上下文内容：不锁页面滚动、不让背景 inert、不使用指向
// Trigger 的箭头；Portal、定位、碰撞、Outside Click、Dismiss 与焦点恢复统一
// 由 FloatingLayer 负责（目录私有，按文件直接 import）。
// 视觉只消费 tokens.css 的浮层 token：rounded-surface-lg（20px）、
// border-floating-edge、bg-floating-bg、shadow-floating、z-floating。
// 业务不传 placement / 宽度 / 阴影（规范 §8.1）。

const POPOVER_SURFACE_CLASS =
  'rounded-surface-lg border border-floating-edge bg-floating-bg shadow-floating z-floating outline-none ' +
  'motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--ease-out)] ' +
  'data-[entering]:opacity-0 data-[exiting]:opacity-0 data-[entering]:motion-safe:-translate-y-1';

/** hover 意图只在 fine pointer 下成立；coarse pointer 由点击承担（规范 §8.3 / §9）。 */
function isCoarsePointer(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export type PopoverProps = {
  /** 锚定内容的可访问名称（模态变体带 role="dialog"） */
  'aria-label'?: string;
  trigger: ReactElement;
  children: ReactNode;
};

/**
 * 基础锚定 Popover：日期等上下文内容（规范 §8.1）。
 * 点击 Trigger 开合；打开后焦点进入首个逻辑控件；外部点击 / Escape 关闭；
 * 关闭后焦点恢复 Trigger。
 */
export function Popover({ 'aria-label': ariaLabel, trigger, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Interactive Popover 打开后焦点进入首个逻辑控件（规范 §8.1）。
  // 本 effect 先于浮面自聚焦运行（子先父后），焦点已在浮面内时
  // react-aria 的 focusSafely 会让位；DismissButton 以 tabindex=-1 排除。
  useEffect(() => {
    if (!open) return;
    contentRef.current
      ?.querySelector<HTMLElement>(
        'button:not([tabindex="-1"]), a[href], input, select, textarea, [tabindex="0"]',
      )
      ?.focus();
  }, [open]);

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-block"
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </span>
      <FloatingLayer
        open={open}
        onOpenChange={setOpen}
        triggerRef={anchorRef}
        excludeTriggerFromOutside
        aria-label={ariaLabel}
        className={POPOVER_SURFACE_CLASS}
      >
        <div ref={contentRef}>{children}</div>
      </FloatingLayer>
    </>
  );
}

export type ReactionPopoverProps = {
  /** 通常是 IconButton；aria-haspopup / aria-expanded 由组件负责 */
  trigger: ReactElement;
  /** 我当前的表情；没有则为 null */
  value: string | null;
  onChange(emoji: string): void;
};

const REACTION_COLUMNS = 5;

/**
 * 表情选择（规范 §8.2）：桌面与移动端都保持锚定，不转 ActionSheet。
 * 紧凑 Emoji Grid；打开后聚焦当前表情或第一个；方向键按网格移动；
 * Enter / Space 选择后立即关闭并把焦点返回表情入口。
 */
export function ReactionPopover({
  trigger,
  value,
  onChange,
}: ReactionPopoverProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const focusCell = (index: number) => {
    const cells =
      gridRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="gridcell"] button',
      ) ?? [];
    cells[index]?.focus();
  };

  // 打开时落定初始位置：当前表情；没有当前表情时第一个（规范 §8.2）
  const toggleOpen = () => {
    if (!open) {
      const current = value
        ? REACTION_EMOJIS.indexOf(value as (typeof REACTION_EMOJIS)[number])
        : -1;
      setActiveIndex(current >= 0 ? current : 0);
    }
    setOpen(!open);
  };

  // 打开后把焦点放进网格。本 effect 先于浮面自聚焦运行（子先父后），
  // 焦点已在浮面内时 react-aria 的 focusSafely 会让位。
  useEffect(() => {
    if (!open) return;
    focusCell(activeIndex);
  }, [open, activeIndex]);

  // 二维网格导航（规范 §8.2）：元素级 keydown，边界不越界；
  // Escape / Enter 不在这里拦截，沿 React keydown 链交给浮层与按钮原生行为。
  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(activeIndex + 1, REACTION_EMOJIS.length - 1);
        break;
      case 'ArrowLeft':
        next = Math.max(activeIndex - 1, 0);
        break;
      case 'ArrowDown':
        next = Math.min(
          activeIndex + REACTION_COLUMNS,
          REACTION_EMOJIS.length - 1,
        );
        break;
      case 'ArrowUp':
        next = Math.max(activeIndex - REACTION_COLUMNS, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = REACTION_EMOJIS.length - 1;
        break;
    }
    if (next !== null && next !== activeIndex) {
      event.preventDefault();
      setActiveIndex(next);
      focusCell(next);
    }
  };

  // 选择后立即关闭；焦点恢复由 FloatingLayer 的 FocusScope 负责（规范 §8.2）
  const select = (emoji: string) => {
    setOpen(false);
    onChange(emoji);
  };

  const rows = [
    REACTION_EMOJIS.slice(0, REACTION_COLUMNS),
    REACTION_EMOJIS.slice(REACTION_COLUMNS),
  ];

  return (
    <>
      <span ref={anchorRef} className="inline-block" onClick={toggleOpen}>
        {cloneElement(trigger as ReactElement<Record<string, unknown>>, {
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
        })}
      </span>
      <FloatingLayer
        open={open}
        onOpenChange={setOpen}
        triggerRef={anchorRef}
        excludeTriggerFromOutside
        className={`${POPOVER_SURFACE_CLASS} p-menu`}
      >
        <div
          ref={gridRef}
          role="grid"
          aria-label="选择表情"
          className="outline-none"
          onKeyDown={handleGridKeyDown}
        >
          {rows.map((row, rowIndex) => (
            <div role="row" className="flex" key={rowIndex}>
              {row.map((emoji, colIndex) => {
                const index = rowIndex * REACTION_COLUMNS + colIndex;
                return (
                  <div role="gridcell" key={emoji}>
                    <button
                      type="button"
                      tabIndex={index === activeIndex ? 0 : -1}
                      aria-label={emoji}
                      aria-pressed={value === emoji}
                      onClick={() => select(emoji)}
                      className="flex h-icon-button w-icon-button items-center justify-center rounded-menu-item text-lg outline-none hover:bg-floating-hover focus-visible:bg-floating-hover focus-visible:ring-focus pointer-coarse:h-11 pointer-coarse:w-11"
                    >
                      {emoji}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </FloatingLayer>
    </>
  );
}

export type MemberPopoverProps = {
  /** 身份信息：姓名与可选角色文案（如“创建者”） */
  member: { nickname: string; role?: string };
  /** 触发元素（如成员头像按钮）；焦点始终留在它上面 */
  children: ReactElement;
};

/**
 * 成员身份信息（规范 §8.3）：替代 HoverTip。
 * 桌面 hover / focus 约 300ms 后打开；指针跨入浮面保持；点击 / 触摸立即打开；
 * 焦点留在 Trigger 上，浮面以描述关系对读屏可达；外部按下 / Escape 关闭。
 */
export function MemberPopover({ member, children }: MemberPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const contentId = useId();
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveringRef = useRef(false);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  useEffect(() => clearTimers, []);

  const close = () => {
    clearTimers();
    setPinned(false);
    setOpen(false);
  };

  // 桌面 hover / focus 约 300ms 后打开（规范 §8.3）
  const scheduleOpen = () => {
    if (isCoarsePointer()) return;
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), 300);
  };

  // 指针从 Trigger 移向浮面需要缓冲；进入浮面会取消关闭（指针跨入保持）
  const scheduleClose = () => {
    if (pinned) return;
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-block"
        onMouseEnter={() => {
          hoveringRef.current = true;
          scheduleOpen();
        }}
        onMouseLeave={() => {
          hoveringRef.current = false;
          scheduleClose();
        }}
        onFocus={scheduleOpen}
        onBlur={() => {
          clearTimers();
          if (!hoveringRef.current && !pinned) setOpen(false);
        }}
        onClick={() => {
          // 点击 / 触摸立即固定打开（规范 §8.3）
          clearTimers();
          setPinned(true);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        {cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-describedby': open ? contentId : undefined,
        })}
      </span>
      <FloatingLayer
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        triggerRef={anchorRef}
        nonModal
        placement="bottom"
        className="w-max max-w-60 rounded-surface-lg border border-floating-edge bg-floating-bg p-3 shadow-floating z-floating"
      >
        <div
          id={contentId}
          data-testid="member-card"
          onMouseEnter={() => {
            hoveringRef.current = true;
            clearTimers();
          }}
          onMouseLeave={() => {
            hoveringRef.current = false;
            scheduleClose();
          }}
        >
          <span className="block text-sm font-medium text-ink">
            {member.nickname}
          </span>
          {member.role ? (
            <span className="mt-0.5 block text-meta text-muted">
              {member.role}
            </span>
          ) : null}
        </div>
      </FloatingLayer>
    </>
  );
}
