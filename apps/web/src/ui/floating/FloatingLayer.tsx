import type { ComponentProps, ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import { Popover as RACPopover } from 'react-aria-components';

// FloatingLayer：Portal、定位、碰撞、Outside Click、Dismiss 与焦点恢复的内部
// 能力（Menu/Popover/Tooltip 规范 §10）。
//
// 目录私有契约：
// - 没有 ui/floating/index.ts barrel，本文件只被 menu/popover/tooltip 的实现
//   按文件直接 import；业务与其它目录禁止引用（规范 §2）。
// - 视觉不做任何决策：浮面的色彩、几何、层级由各语义实现经 className 注入
//   token 化类名（moment-floating 只是测试与调试的标记类，无样式）。
// - Escape 走 react-aria 的浮层内 keydown 链，本文件不挂任何 window 级键盘监听。
// - 定位参数（offset / containerPadding）分别对应 token --menu-offset 与
//   --menu-viewport-gap；placement 是内部决策，不向业务开放。

type RACPopoverProps = ComponentProps<typeof RACPopover>;

export type FloatingPlacement = NonNullable<RACPopoverProps['placement']>;

export type FloatingLayerProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 定位锚点；同时是焦点恢复与（可选的）外部点击排除的对象 */
  triggerRef: RefObject<Element | null>;
  /** 内部定位决策（规范 §5.2 默认 bottom end；Tooltip 用 top），业务不可见 */
  placement?: FloatingPlacement;
  /** 信息型浮面（MemberPopover / Tooltip）：不抢焦点、不圈禁、不渲染 DismissButton */
  nonModal?: boolean;
  /** 非模态浮面是否响应外部指针关闭；Tooltip 由 hover/focus 生命周期自管 */
  dismissOnOutsidePress?: boolean;
  /** Trigger 自带开合语义（如调用方自行 toggle）时置 true：Trigger 上的按下不当作外部点击 */
  excludeTriggerFromOutside?: boolean;
  /** 浮面的可访问名称（模态变体带 role="dialog"） */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** 语义实现注入的浮面视觉类（只含 token 化类名）；业务不传 */
  className?: string;
  children: ReactNode;
};

export function FloatingLayer({
  open,
  onOpenChange,
  triggerRef,
  placement = 'bottom end',
  nonModal = false,
  dismissOnOutsidePress = true,
  excludeTriggerFromOutside = false,
  className = '',
  children,
  ...ariaProps
}: FloatingLayerProps) {
  const popoverRef = useRef<HTMLElement | null>(null);

  // Trigger 滚出视口后关闭（规范 §7.1 / §8.1）。
  // 以可视视口（window.innerWidth/Height）判定；scroll 用捕获阶段以覆盖任意滚动容器。
  useEffect(() => {
    if (!open) return;
    const check = () => {
      const anchor = triggerRef.current;
      if (!anchor) {
        onOpenChange(false);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        onOpenChange(false);
      }
    };
    window.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check, true);
      window.removeEventListener('resize', check);
    };
  }, [open, onOpenChange, triggerRef]);

  // 非模态浮面的外部指针关闭：模态路径由 react-aria useOverlay 统一负责，
  // 这里只补非模态分支；Trigger 上的按下永远不算外部（开合由调用方语义决定）。
  useEffect(() => {
    if (!open || !nonModal || !dismissOnOutsidePress) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, nonModal, dismissOnOutsidePress, onOpenChange, triggerRef]);

  return (
    <RACPopover
      ref={popoverRef}
      triggerRef={triggerRef}
      isOpen={open}
      onOpenChange={onOpenChange}
      placement={placement}
      offset={8}
      containerPadding={8}
      isNonModal={nonModal}
      shouldCloseOnInteractOutside={
        excludeTriggerFromOutside
          ? (element) => !triggerRef.current?.contains(element)
          : undefined
      }
      className={`moment-floating ${className}`}
      {...ariaProps}
    >
      {children}
    </RACPopover>
  );
}
