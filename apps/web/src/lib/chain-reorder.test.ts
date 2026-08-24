import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  LONG_PRESS_ARM_MS,
  createDragGesture,
  insertionIndex,
  moveItem,
  type DragGestureHandlers,
  type DragGesturePointerEvent,
} from './chain-reorder';

// 拖拽手势状态机（spec chain-ordering §6.2/§7）：
// pointerType 激活方式（mouse 6px / touch·pen 长按 350ms armed 后 6px）、armed 前移动让位滚动、
// pointercancel 清理、仅跟踪 isPrimary 主指针、松手 click 抑制、contextmenu suppress 窗口。

function makeHandlers() {
  return {
    onActivate: vi.fn(),
    onDragMove: vi.fn(),
    onDrop: vi.fn(),
    onAbort: vi.fn(),
  } satisfies DragGestureHandlers;
}

function down(over: Partial<DragGesturePointerEvent> = {}): DragGesturePointerEvent {
  return { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100, ...over };
}

function move(over: Partial<DragGesturePointerEvent> = {}) {
  return { pointerId: 1, clientX: 100, clientY: 100, ...over };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('常量（spec §6.2b）', () => {
  it('阈值 6px / 长按 350ms', () => {
    expect(DRAG_THRESHOLD_PX).toBe(6);
    expect(LONG_PRESS_ARM_MS).toBe(350);
  });
});

describe('moveItem / insertionIndex', () => {
  it('moveItem：前移 / 后移 / 原位', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('insertionIndex：不计排除项，按中点计数', () => {
    const midpoints = [10, 30, 50]; // 三项主轴中点，排除 index 1（拖动项）
    expect(insertionIndex(5, midpoints, 1)).toBe(0); // 最前
    expect(insertionIndex(20, midpoints, 1)).toBe(1); // 中点 10 在前
    expect(insertionIndex(40, midpoints, 1)).toBe(1); // 中点 50 仍在后
    expect(insertionIndex(60, midpoints, 1)).toBe(2); // 最后（排除项不计数）
  });
});

describe('mouse：6px 阈值激活（§6.2b）', () => {
  it('阈值内移动不激活；未激活的 pointerup = 普通点击，无回调无 click 抑制', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down());
    g.pointerMove(move({ clientY: 103 })); // 3px < 6px
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(g.phase).toBe('pending');

    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(handlers.onAbort).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');
    expect(g.consumeClickSuppress()).toBe(false); // 普通点击不抑制导航（§6.2e）
  });

  it('超阈值激活：onActivate 后同帧 onDragMove；松手 onDrop 且 click 抑制只消费一次', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down());
    g.pointerMove(move({ clientY: 107 })); // 7px > 6px
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(7);
    expect(g.phase).toBe('dragging');
    expect(g.suppressContextMenu).toBe(true); // 激活期间 suppress contextmenu（§6.2c）

    g.pointerMove(move({ clientY: 120 }));
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(20);

    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledTimes(1);
    expect(handlers.onAbort).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');
    expect(g.suppressContextMenu).toBe(false);
    expect(g.consumeClickSuppress()).toBe(true); // 松手后 click 抑制（§6.2e）
    expect(g.consumeClickSuppress()).toBe(false); // 读取即消费，只一次
  });

  it('x 轴：按 clientX 计算位移', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'x', handlers });
    g.pointerDown(down());
    g.pointerMove(move({ clientX: 93, clientY: 100 })); // -7px
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(-7);
  });
});

describe('touch / pen：长按 armed 后移动才激活（§6.2b/§6.2c）', () => {
  it('armed 前（<350ms）移动 = 放弃手势让位滚动：onAbort，后续事件全部忽略', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(100);
    g.pointerMove(move({ clientY: 101 })); // armed 前任何移动即放弃
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');

    // 手势已放弃：同 pointerId 的后续移动/松手不再有任何回调（浏览器已接管滚动）
    g.pointerMove(move({ clientY: 130 }));
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDragMove).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });

  it('长按 350ms armed 后，位移超阈值才激活；armed 后阈值内移动不激活', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(LONG_PRESS_ARM_MS); // armed
    g.pointerMove(move({ clientY: 103 })); // 3px，阈值内
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(g.phase).toBe('pending');

    g.pointerMove(move({ clientY: 110 })); // 10px 激活
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(10);
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledTimes(1);
  });

  it('长按 armed 后未移动即松手 = 长按菜单场景：无激活无提交，不抑制 click', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(LONG_PRESS_ARM_MS);
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(handlers.onAbort).not.toHaveBeenCalled();
    expect(g.consumeClickSuppress()).toBe(false); // contextmenu 由平台派发，手势不干预（§6.2c）
  });

  it('pen 与 touch 同规则：armed 前移动放弃（iPad + Pencil 同受滚动接管约束）', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'pen' }));
    vi.advanceTimersByTime(50);
    g.pointerMove(move({ clientY: 120 }));
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onActivate).not.toHaveBeenCalled();
  });
});

describe('pointercancel 清理与多点触控（§6.2d）', () => {
  it('dragging 中 pointercancel：onAbort 清理，无提交，不抑制 click', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down());
    g.pointerMove(move({ clientY: 110 })); // 激活
    g.pointerCancel({ pointerId: 1 });
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(handlers.onDrop).not.toHaveBeenCalled();
    expect(g.phase).toBe('idle');
    expect(g.suppressContextMenu).toBe(false);
    expect(g.consumeClickSuppress()).toBe(false);
  });

  it('pending（已 armed）中 pointercancel：onAbort', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerType: 'touch' }));
    vi.advanceTimersByTime(LONG_PRESS_ARM_MS);
    g.pointerCancel({ pointerId: 1 });
    expect(handlers.onAbort).toHaveBeenCalledTimes(1);
    expect(g.phase).toBe('idle');
  });

  it('只跟踪 isPrimary 主指针：副指针的 down/move/up 全部忽略，主指针流程不受影响', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    // 副指针先落下（isPrimary=false）：完全不开启手势
    g.pointerDown(down({ pointerId: 2, isPrimary: false }));
    expect(g.phase).toBe('idle');

    // 主指针手势开始并激活
    g.pointerDown(down({ pointerId: 1 }));
    // 拖拽中第二根手指落下（儿童误触）：down / move / up 均不影响
    g.pointerDown(down({ pointerId: 2, isPrimary: false }));
    g.pointerMove(move({ pointerId: 2, clientY: 200 }));
    g.pointerUp({ pointerId: 2 });
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(handlers.onAbort).not.toHaveBeenCalled();

    g.pointerMove(move({ clientY: 120 }));
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(20);

    // 主指针 pointerId 不匹配的 cancel 也忽略
    g.pointerCancel({ pointerId: 9 });
    expect(g.phase).toBe('dragging');
    g.pointerUp({ pointerId: 1 });
    expect(handlers.onDrop).toHaveBeenCalledTimes(1);
  });

  it('手势进行中新的 pointerDown 被忽略（单手势状态机）', () => {
    const handlers = makeHandlers();
    const g = createDragGesture({ axis: 'y', handlers });

    g.pointerDown(down({ pointerId: 1 }));
    g.pointerDown(down({ pointerId: 1, clientY: 500 })); // 重复 down 不重置起点
    g.pointerMove(move({ clientY: 110 }));
    expect(handlers.onDragMove).toHaveBeenLastCalledWith(10); // 起点仍是 100
  });
});
