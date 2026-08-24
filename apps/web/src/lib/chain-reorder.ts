// 链拖拽排序纯逻辑（spec chain-ordering §6.2/§7）：手势状态机 + 顺序计算。
// 不依赖 React / DOM——事件入参是最小结构接口（React PointerEvent 结构化兼容），
// 计时用全局 setTimeout（测试经 vi.useFakeTimers 驱动）。DOM 接线见 shell/chain-nav-list.tsx。

/** 拖拽主轴位移阈值（px）：mouse 直接按阈值激活；touch/pen 长按 armed 后同样按阈值激活（§6.2b） */
export const DRAG_THRESHOLD_PX = 6;
/** touch/pen 长按进入 armed 态的时长（ms）；armed 前任何移动 = 放弃手势让位原生滚动（§6.2b） */
export const LONG_PRESS_ARM_MS = 350;

/** 给定 items 与 from/to 计算新顺序：移除 from 项后插入到 to（to = 移除后的最终下标）。 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * 由指针主轴坐标与各项主轴中点计算插入后下标：
 * 不计 excludeIndex（拖动项自身），返回中点严格小于 pointer 的项数——即拖动项的最终下标。
 */
export function insertionIndex(pointer: number, midpoints: readonly number[], excludeIndex: number): number {
  let count = 0;
  for (let i = 0; i < midpoints.length; i++) {
    if (i === excludeIndex) continue;
    if ((midpoints[i] as number) < pointer) count++;
  }
  return count;
}

export type DragPhase = 'idle' | 'pending' | 'dragging';

/** 最小指针事件结构：React PointerEvent 与本接口结构化兼容，组件层无需适配。 */
export interface DragGesturePointerEvent {
  pointerId: number;
  isPrimary: boolean;
  pointerType: string;
  clientX: number;
  clientY: number;
}

export interface DragGestureHandlers {
  /** 拖拽激活：组件层开始视觉反馈，并挂非 passive touchmove preventDefault 阻止滚动接管（§6.2b） */
  onActivate(): void;
  /** 激活后移动：主轴位移 px（当前坐标 - 按下坐标，含符号） */
  onDragMove(offset: number): void;
  /** 激活后松手：提交新顺序。紧随的 click 由 consumeClickSuppress 抑制（§6.2e） */
  onDrop(): void;
  /** 任意阶段中止（armed 前移动 / pointercancel）：清理临时态，不产生提交（§6.2d） */
  onAbort(): void;
}

export interface DragGesture {
  readonly phase: DragPhase;
  /** 拖拽激活期间为 true：组件层在 contextmenu 捕获阶段 suppress 本次菜单（§6.2c） */
  readonly suppressContextMenu: boolean;
  pointerDown(e: DragGesturePointerEvent): void;
  pointerMove(e: Pick<DragGesturePointerEvent, 'pointerId' | 'clientX' | 'clientY'>): void;
  pointerUp(e: Pick<DragGesturePointerEvent, 'pointerId'>): void;
  pointerCancel(e: Pick<DragGesturePointerEvent, 'pointerId'>): void;
  /** 激活过的拖拽松手后为 true 一次（读取即清除）：组件层在 click 捕获阶段抑制导航（§6.2e） */
  consumeClickSuppress(): boolean;
}

/**
 * 单手势状态机（§6.2 逐条）：
 * - 只跟踪主指针（isPrimary）；pointerId 不匹配的事件一律忽略（§6.2d 副指针忽略）；
 * - mouse：位移 > 阈值激活；touch/pen：350ms 长按 armed 后位移 > 阈值才激活，
 *   armed 前任何移动 = 放弃让位滚动（pen 与 touch 同受滚动接管约束，§6.2b）；
 * - 任何阶段 pointercancel → 复位 + onAbort，不提交（§6.2d）；
 * - pending 中 pointerUp = 普通点击 / 长按菜单，静默复位不干预（§6.2c/§6.2e）。
 */
export function createDragGesture(options: { axis: 'x' | 'y'; handlers: DragGestureHandlers }): DragGesture {
  const { axis, handlers } = options;
  const coord = (e: { clientX: number; clientY: number }): number => (axis === 'y' ? e.clientY : e.clientX);

  let phase: DragPhase = 'idle';
  let pointerId = -1;
  let startCoord = 0;
  /** touch/pen 手势（需长按 armed）；mouse 按下即 armed */
  let longPress = false;
  let armed = false;
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  let clickSuppress = false;

  const cancelArm = () => {
    if (armTimer !== null) {
      clearTimeout(armTimer);
      armTimer = null;
    }
  };

  const reset = () => {
    cancelArm();
    phase = 'idle';
    pointerId = -1;
    longPress = false;
    armed = false;
  };

  return {
    get phase() {
      return phase;
    },
    get suppressContextMenu() {
      return phase === 'dragging';
    },
    consumeClickSuppress() {
      const value = clickSuppress;
      clickSuppress = false;
      return value;
    },
    pointerDown(e) {
      if (!e.isPrimary) return; // 只跟踪主指针（§6.2d）
      if (phase !== 'idle') return; // 单手势：进行中的手势不被新 down 打断
      clickSuppress = false; // 旧抑制标记随新手势清除（真实 click 必 preceded by pointerdown）
      pointerId = e.pointerId;
      startCoord = coord(e);
      longPress = e.pointerType !== 'mouse'; // touch/pen 同走长按分支（§6.2b）
      armed = !longPress;
      phase = 'pending';
      if (longPress) {
        armTimer = setTimeout(() => {
          armTimer = null;
          if (phase === 'pending') armed = true;
        }, LONG_PRESS_ARM_MS);
      }
    },
    pointerMove(e) {
      if (phase === 'idle' || e.pointerId !== pointerId) return; // 未跟踪 / 副指针
      const offset = coord(e) - startCoord;
      if (phase === 'dragging') {
        handlers.onDragMove(offset);
        return;
      }
      // pending
      if (longPress && !armed) {
        // armed 前移动 = 放弃手势让位原生滚动（§6.2b）；浏览器随后接管并可能补发 pointercancel（已 idle，忽略）
        reset();
        handlers.onAbort();
        return;
      }
      if (Math.abs(offset) > DRAG_THRESHOLD_PX) {
        cancelArm();
        phase = 'dragging';
        handlers.onActivate();
        handlers.onDragMove(offset); // 同帧位移不丢
      }
    },
    pointerUp(e) {
      if (phase === 'idle' || e.pointerId !== pointerId) return;
      if (phase === 'dragging') {
        reset();
        clickSuppress = true; // 抑制紧随的 click，防松手触发导航（§6.2e）
        handlers.onDrop();
      } else {
        reset(); // 未激活的 pointerup = 普通点击 / 长按菜单，不干预（§6.2c/§6.2e）
      }
    },
    pointerCancel(e) {
      if (phase === 'idle' || e.pointerId !== pointerId) return;
      reset();
      handlers.onAbort(); // §6.2d：浏览器接管滚动 / 系统打断，中止并清理
    },
  };
}
