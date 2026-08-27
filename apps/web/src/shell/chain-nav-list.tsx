import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useMatch, useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ChainMark } from '@/chain/ChainMark';
import {
  createDragGesture,
  dropOrder,
  insertionIndex,
  moveItem,
  type DragGesture,
} from '@/lib/chain-reorder';
import { ChainListService } from '@/services/chain-list.service';
import { useToast } from '@/ui/feedback/index';
// 必须显式指向 barrel：src/ui/ 下遗留 Menu.tsx 会截获裸目录导入（见 ui/menu/index.ts）
import { ContextMenu, MenuItem, type ContextMenuHandle } from '@/ui/menu/index';

type Axis = 'x' | 'y';
type ItemClassName = (args: { isActive: boolean }) => string;

type DragState = {
  id: string;
  /** 当前插入后下标（不计拖动项自身） */
  index: number;
  el: HTMLElement;
  /** 按下时刻的指针主轴坐标（clientX/Y 坐标系，与 getBoundingClientRect 同空间） */
  startPointer: number;
  /** 抓取偏移：按下时指针相对被拖项左上角的位移，ghost 跟手定位用 */
  grabOffsetX: number;
  grabOffsetY: number;
  /** 按下时采样的被拖项几何，ghost 复刻同一尺寸 */
  width: number;
  height: number;
  /** 最近一次 pointerdown/pointermove 的指针坐标（组件层顺带记录，手势机契约不变） */
  pointerX: number;
  pointerY: number;
};

/** 跟随指针的浮动副本初始渲染数据；激活后的位移直改 style，不经过 React 渲染 */
type GhostState = {
  id: string;
  name: string;
  color: ChainDto['color'];
  icon: ChainDto['icon'];
  avatarMediaId: ChainDto['avatarMediaId'];
  avatarFocus: ChainDto['avatarFocus'];
  width: number;
  height: number;
  x: number;
  y: number;
};

/** FLIP 内联 transition 的清理时长：略大于 --ease（180ms），动画结束后还原元素内联样式 */
const FLIP_CLEANUP_MS = 200;

function axisCoord(e: { clientX: number; clientY: number }, axis: Axis): number {
  return axis === 'y' ? e.clientY : e.clientX;
}

function rectMidpoint(rect: DOMRect, axis: Axis): number {
  return axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
}

/**
 * 可拖拽排序的链导航列表（spec chain-ordering §6.1）：Shell 侧栏（axis=y）与顶部 chips（axis=x）共用。
 * 手势状态机在 @/lib/chain-reorder（纯逻辑，单测覆盖）；本组件只做 DOM 接线：
 * draggable={false} 压锚元素原生拖拽（§6.2a）；激活后挂非 passive touchmove preventDefault
 * 阻止滚动接管（§6.2b）；contextmenu 捕获阶段 suppress + 已开菜单经 ContextMenuHandle 关闭（§6.2c）；
 * 松手后抑制紧随的 click 防误导航（§6.2e）。拖拽手势期间的临时顺序只在本组件内，松手才调 reorder（§6.3）。
 *
 * 拖拽视觉（已批准方案）：
 * - 激活时创建 portal 到 body 的 ghost 浮动副本，按「指针 - 抓取偏移」经 transform 跟手，
 *   原位项保留在文档流中作半透明占位（「洞」）；
 * - 拖拽途中按 insertionIndex 把占位换到目标槽位，其它项经 FLIP 平滑让位/回位（替代原静态指示线）；
 * - 松手清 ghost、提交不变；中止清 ghost、视觉序还原并 FLIP 滑回，不提交。
 */
export const ChainNavList = observer(function ChainNavList({
  chains,
  axis,
  itemClassName,
}: {
  chains: ChainDto[];
  axis: Axis;
  itemClassName: ItemClassName;
}) {
  const chainList = useService(ChainListService);
  const toast = useToast();
  const navigate = useNavigate();
  const activeChainId = useMatch('/chains/:chainId')?.params.chainId;
  /** 拖拽中的视觉顺序覆盖：id = 拖动项；index = 插入后下标（不计拖动项自身） */
  const [dragVisual, setDragVisual] = useState<{ id: string; index: number } | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const menusRef = useRef(new Map<string, ContextMenuHandle>());
  const dragRef = useRef<DragState | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const removeTouchBlockRef = useRef<(() => void) | null>(null);
  /** 上一次提交布局的逐项位置（FLIP 的 First；均为不含 transform 的布局值） */
  const lastRectsRef = useRef(new Map<string, DOMRect>());
  /** 在途 FLIP 的清理定时器：再次 FLIP 同项时取消旧定时器，避免中途清掉新 transition */
  const flipTimersRef = useRef(new Map<string, number>());
  // 手势机整个组件生命周期单例：chains 变化（chain:changed 等）不重建，避免拖拽途中被重置；
  // 处理器经 latestRef 读最新 chains / chainList / toast
  const latestRef = useRef({ chains, chainList, toast });
  latestRef.current = { chains, chainList, toast };
  const gestureRef = useRef<DragGesture | null>(null);
  if (gestureRef.current === null) {
    gestureRef.current = createDragGesture({
      axis,
      handlers: {
        onActivate() {
          const drag = dragRef.current;
          if (!drag) return;
          // 已弹出的「链设置」菜单先关闭：长按 + 移动 = 拖拽（§6.2c）
          menusRef.current.get(drag.id)?.close();
          // 激活后阻止浏览器滚动接管（§6.2b）：touch-action 在 pointerdown 时已采样，
          // 手势进行中只能挂非 passive touchmove preventDefault
          const prevent = (ev: TouchEvent) => {
            if (ev.cancelable) ev.preventDefault();
          };
          drag.el.addEventListener('touchmove', prevent, { passive: false });
          removeTouchBlockRef.current = () => drag.el.removeEventListener('touchmove', prevent);
          const item = latestRef.current.chains.find((c) => c.id === drag.id);
          if (!item) return; // 拖项已被删：不建 ghost，松手时 onDrop 放弃提交
          // ghost 初始位置 = 当前指针 - 抓取偏移（跟手不跳位）；后续移动直改 style
          setGhost({
            id: item.id,
            name: item.name,
            color: item.color,
            icon: item.icon,
            avatarMediaId: item.avatarMediaId,
            avatarFocus: item.avatarFocus,
            width: drag.width,
            height: drag.height,
            x: drag.pointerX - drag.grabOffsetX,
            y: drag.pointerY - drag.grabOffsetY,
          });
          setDragVisual({ id: drag.id, index: drag.index });
        },
        onDragMove(offset) {
          const drag = dragRef.current;
          if (!drag) return;
          const { chains: items } = latestRef.current;
          // 拖拽期间列表可能被 chain:changed 重写：排除下标按 id 重算，不用按下时捕获的旧下标
          const from = items.findIndex((c) => c.id === drag.id);
          if (from < 0) {
            setGhost(null);
            setDragVisual(null); // 拖项已被删：回到真实顺序，松手时 onDrop 会放弃提交
            return;
          }
          const pointer = drag.startPointer + offset;
          // 中点取 FLIP 记录的提交布局（当前视觉槽位、不含在途 transform），
          // 阈值随让位后的视觉位置走，不被动画中间态抖出回环
          const midpoints = items.map((c) => {
            const rect = lastRectsRef.current.get(c.id);
            if (rect) return rectMidpoint(rect, axis);
            const el = itemsRef.current.get(c.id);
            return el ? rectMidpoint(el.getBoundingClientRect(), axis) : Number.POSITIVE_INFINITY;
          });
          const next = insertionIndex(pointer, midpoints, from);
          if (next === drag.index) return; // 槽位没变不触发重渲；ghost 位移由组件层直改 style
          drag.index = next;
          setDragVisual({ id: drag.id, index: next });
        },
        onDrop() {
          const drag = dragRef.current;
          removeTouchBlockRef.current?.();
          removeTouchBlockRef.current = null;
          setGhost(null);
          if (!drag) {
            setDragVisual(null);
            return;
          }
          const { chains: items, chainList: list, toast: t } = latestRef.current;
          // 按 id 在当前列表重算 from（拖拽期间列表被重写则旧下标已错位）；拖项被删 = null，放弃提交
          const drop = dropOrder(
            items.map((c) => c.id),
            drag.id,
            drag.index,
          );
          if (!drop || drop.from === drag.index) {
            // 拖项已删 / 原位松手：视觉序即真实序，直接清覆盖，不产生位移
            setDragVisual(null);
            return;
          }
          // 提交路径保留视觉覆盖，待 chains 真实更新后由 effect 清除，列表不闪回旧序；
          // 乐观更新 / 失败回滚 + 收敛由 service 统一 load 完成（§6.3）；失败 toast 遵循 Feedback 规范
          void list.reorder(drop.orderedIds).catch(() =>
            t.show({ key: 'chain-reorder-failed', message: '链顺序保存失败，已恢复原顺序' }),
          );
        },
        onAbort() {
          removeTouchBlockRef.current?.();
          removeTouchBlockRef.current = null;
          dragRef.current = null;
          setGhost(null);
          setDragVisual(null); // 视觉序还原为真实序（FLIP 滑回），不提交
        },
      },
    });
  }
  const gesture = gestureRef.current;

  // 卸载清理在途 FLIP 的清理定时器：元素随组件卸载，定时器不再有必要（也避免命中已卸载节点）
  useEffect(() => {
    const timers = flipTimersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // 松手提交后保留视觉顺序直到真实列表更新（reorder 乐观写同步发生，提交时序见 §6.3），
  // 避免先闪回旧序再跳新序；乐观写被跳过 / 失败回滚时，收尾 load 的 chains 变更同样经这里
  // 收敛（FLIP 归位）。拖拽进行中（phase === 'dragging'）的 chain:changed 不会误清覆盖。
  useEffect(() => {
    if (dragVisual && gesture.phase === 'idle') setDragVisual(null);
  }, [chains, dragVisual, gesture]);

  // FLIP：每次提交布局后逐项比对位置差，位移非零的项先 apply 反向 transform（无 transition），
  // 强制 reflow 后清零并播放 transition（时长走 --ease），其它项因此平滑让位/回位。
  // 拖动项的占位「洞」不播动画、直接换槽（视觉由 ghost 承载）。无依赖数组 = 任意来源的顺序
  // 变化（拖拽覆盖 / 提交 / 中止 / 外部 chain:changed）都走同一条路径。
  useLayoutEffect(() => {
    const prev = lastRectsRef.current;
    const next = new Map<string, DOMRect>();
    itemsRef.current.forEach((el, id) => {
      const measured = el.getBoundingClientRect(); // 含在途 FLIP transform 的视觉位置
      let layout = measured;
      const timer = flipTimersRef.current.get(id);
      if (timer !== undefined) {
        // 在途动画：停掉旧清理、还原布局位置，以当前视觉位置为本次动画起点（接力不跳变）
        window.clearTimeout(timer);
        flipTimersRef.current.delete(id);
        el.style.transition = 'none';
        el.style.transform = '';
        layout = el.getBoundingClientRect();
        // 量完即还原：后续提前 return（洞静默换槽 / 位移为零）不会把内联 'none' 留在元素上
        // 压制样式表过渡（hover/focus transition-colors）；再走 FLIP 的分支会重新设置
        el.style.transition = '';
      }
      next.set(id, layout);
      if (id === dragVisual?.id) return; // 占位「洞」静默换槽
      const start = timer !== undefined ? measured : (prev.get(id) ?? layout);
      const dx = start.left - layout.left;
      const dy = start.top - layout.top;
      if (dx === 0 && dy === 0) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth; // 强制 reflow：反向位移在无 transition 下先生效
      el.style.transition = 'transform var(--ease)';
      el.style.transform = '';
      flipTimersRef.current.set(
        id,
        window.setTimeout(() => {
          el.style.transition = '';
          flipTimersRef.current.delete(id);
        }, FLIP_CLEANUP_MS),
      );
    });
    lastRectsRef.current = next;
  });

  const onItemPointerDown = (c: ChainDto) => (e: ReactPointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 只认主键
    if (!e.isPrimary) return; // 副指针一律忽略（§6.2d）
    if (gesture.phase !== 'idle') return; // 单手势
    if (menusRef.current.get(c.id)?.isOpen()) return; // 菜单已打开：本次按压属菜单语境，不启动拖拽（§6.2c）
    const el = e.currentTarget;
    if (e.pointerType === 'mouse') el.setPointerCapture?.(e.pointerId); // touch/pen 有隐式捕获；jsdom 无此方法，可选调用
    // 下标按 id 在真实列表取（提交后视觉覆盖尚未收敛时，渲染序可能与真实序短暂错位）
    const index = latestRef.current.chains.findIndex((x) => x.id === c.id);
    if (index < 0) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      id: c.id,
      index,
      el,
      startPointer: axisCoord(e, axis),
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      pointerX: e.clientX,
      pointerY: e.clientY,
    };
    gesture.pointerDown(e);
  };

  const onItemPointerMove = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    const drag = dragRef.current;
    if (drag) {
      drag.pointerX = e.clientX;
      drag.pointerY = e.clientY;
    }
    gesture.pointerMove(e);
    // ghost 跟手：transform 直改 style（合成层位移，不引发布局抖动）；激活当帧 ghost
    // 尚未挂载，初始位置由 state 渲染给出
    const ghostEl = ghostElRef.current;
    if (drag && ghostEl && gesture.phase === 'dragging') {
      ghostEl.style.transform = `translate(${drag.pointerX - drag.grabOffsetX}px, ${
        drag.pointerY - drag.grabOffsetY
      }px)`;
    }
  };

  // 视觉顺序：拖拽中把被拖项的占位移到目标槽位；拖项被删回退真实顺序
  let visualChains = chains;
  if (dragVisual) {
    const from = chains.findIndex((c) => c.id === dragVisual.id);
    if (from >= 0) visualChains = moveItem(chains, from, dragVisual.index);
  }

  return (
    <>
      {visualChains.map((c) => (
        <ContextMenu
          key={c.id}
          ref={(handle: ContextMenuHandle | null) => {
            if (handle) menusRef.current.set(c.id, handle);
            else menusRef.current.delete(c.id);
          }}
          aria-label={`${c.name} 的链操作`}
          onAction={(key) => {
            if (key === 'settings') navigate(`/chains/${c.id}/settings`);
          }}
          items={
            <MenuItem id="settings" textValue="链设置">
              链设置
            </MenuItem>
          }
        >
          <NavLink
            to={`/chains/${c.id}`}
            draggable={false}
            ref={(el: HTMLAnchorElement | null) => {
              if (el) itemsRef.current.set(c.id, el);
              else itemsRef.current.delete(c.id);
            }}
            className={(args) => `${itemClassName(args)}${dragVisual?.id === c.id ? ' opacity-50' : ''}`}
            onPointerDown={onItemPointerDown(c)}
            onPointerMove={onItemPointerMove}
            onPointerUp={(e) => {
              gesture.pointerUp(e);
              if (gesture.phase === 'idle') dragRef.current = null; // 未激活的 pointerup（普通点击）清掉临时态
            }}
            onPointerCancel={(e) => gesture.pointerCancel(e)}
            onClickCapture={(e) => {
              // 激活过拖拽的手势结束后抑制随后的 click（§6.2e）；普通点击不置标记，导航不变
              if (gesture.consumeClickSuppress()) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onContextMenuCapture={(e) => {
              // 仅当拖拽已因移动而激活时才 suppress 本次 contextmenu（§6.2c）；未激活则菜单照常弹
              if (gesture.suppressContextMenu) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <ChainMark
              chainId={c.id}
              color={c.color}
              icon={c.icon}
              avatarMediaId={c.avatarMediaId}
              avatarFocus={c.avatarFocus}
              size={16}
            />
            <span className="truncate">{c.name}</span>
          </NavLink>
        </ContextMenu>
      ))}
      {ghost &&
        createPortal(
          // 跟随指针的浮动副本：内容与被拖项一致，几何沿用 itemClassName；pointer-events-none
          // 不挡下层交互，z 档位消费既有 --z-overlay token
          <div
            ref={ghostElRef}
            aria-hidden
            className={`pointer-events-none fixed left-0 top-0 z-overlay bg-surface opacity-90 ${itemClassName({ isActive: ghost.id === activeChainId })}`}
            style={{
              width: ghost.width,
              height: ghost.height,
              transform: `translate(${ghost.x}px, ${ghost.y}px)`,
            }}
          >
            <ChainMark
              chainId={ghost.id}
              color={ghost.color}
              icon={ghost.icon}
              avatarMediaId={ghost.avatarMediaId}
              avatarFocus={ghost.avatarFocus}
              size={16}
            />
            <span className="truncate">{ghost.name}</span>
          </div>,
          document.body,
        )}
    </>
  );
});
