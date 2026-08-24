import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ChainMark } from '@/chain/ChainMark';
import {
  createDragGesture,
  dropOrder,
  insertionIndex,
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
  from: number;
  index: number;
  el: HTMLElement;
  /** 按下时刻的指针主轴坐标（clientX/Y 坐标系，与 getBoundingClientRect 同空间） */
  startPointer: number;
};

function axisCoord(e: { clientX: number; clientY: number }, axis: Axis): number {
  return axis === 'y' ? e.clientY : e.clientX;
}

function midpointOf(el: HTMLElement, axis: Axis): number {
  const rect = el.getBoundingClientRect();
  return axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
}

/** 插入指示线（spec §6.2f）：只消费 --action token；h-0.5 / w-0.5 是 Tailwind 刻度值，非一次性尺寸 */
function DropIndicator({ axis }: { axis: Axis }) {
  return (
    <span
      aria-hidden
      className={
        axis === 'y'
          ? 'h-0.5 shrink-0 rounded-full bg-action'
          : 'w-0.5 shrink-0 self-stretch rounded-full bg-action'
      }
    />
  );
}

/**
 * 可拖拽排序的链导航列表（spec chain-ordering §6.1）：Shell 侧栏（axis=y）与顶部 chips（axis=x）共用。
 * 手势状态机在 @/lib/chain-reorder（纯逻辑，单测覆盖）；本组件只做 DOM 接线：
 * draggable={false} 压锚元素原生拖拽（§6.2a）；激活后挂非 passive touchmove preventDefault
 * 阻止滚动接管（§6.2b）；contextmenu 捕获阶段 suppress + 已开菜单经 ContextMenuHandle 关闭（§6.2c）；
 * 松手后抑制紧随的 click 防误导航（§6.2e）。拖拽手势期间的临时顺序只在本组件内，松手才调 reorder（§6.3）。
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
  /** 拖动中的视觉态：id = 拖动项；index = 插入后下标（不计拖动项自身） */
  const [indicator, setIndicator] = useState<{ id: string; index: number } | null>(null);
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const menusRef = useRef(new Map<string, ContextMenuHandle>());
  const dragRef = useRef<DragState | null>(null);
  const removeTouchBlockRef = useRef<(() => void) | null>(null);
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
          setIndicator({ id: drag.id, index: drag.index });
        },
        onDragMove(offset) {
          const drag = dragRef.current;
          if (!drag) return;
          const { chains: items } = latestRef.current;
          // 拖拽期间列表可能被 chain:changed 重写：排除下标按 id 重算，不用按下时捕获的旧下标
          const from = items.findIndex((c) => c.id === drag.id);
          if (from < 0) {
            setIndicator(null); // 拖项已被删：不再更新指示线，松手时 onDrop 会放弃提交
            return;
          }
          const pointer = drag.startPointer + offset;
          const midpoints = items.map((c) => {
            const el = itemsRef.current.get(c.id);
            return el ? midpointOf(el, axis) : Number.POSITIVE_INFINITY;
          });
          drag.index = insertionIndex(pointer, midpoints, from);
          setIndicator({ id: drag.id, index: drag.index });
        },
        onDrop() {
          const drag = dragRef.current;
          removeTouchBlockRef.current?.();
          removeTouchBlockRef.current = null;
          setIndicator(null);
          if (!drag) return;
          const { chains: items, chainList: list, toast: t } = latestRef.current;
          // 按 id 在当前列表重算 from（拖拽期间列表被重写则旧下标已错位）；拖项被删 = null，放弃提交
          const drop = dropOrder(
            items.map((c) => c.id),
            drag.id,
            drag.index,
          );
          if (!drop || drop.from === drag.index) return; // 拖项已删 / 原位松手：顺序未变，不提交
          // 乐观更新 / 失败回滚 + 收敛由 service 统一 load 完成（§6.3）；失败 toast 遵循 Feedback 规范
          void list.reorder(drop.orderedIds).catch(() =>
            t.show({ key: 'chain-reorder-failed', message: '链顺序保存失败，已恢复原顺序' }),
          );
        },
        onAbort() {
          removeTouchBlockRef.current?.();
          removeTouchBlockRef.current = null;
          dragRef.current = null;
          setIndicator(null);
        },
      },
    });
  }
  const gesture = gestureRef.current;

  const onItemPointerDown = (c: ChainDto, index: number) => (e: ReactPointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 只认主键
    if (!e.isPrimary) return; // 副指针一律忽略（§6.2d）
    if (gesture.phase !== 'idle') return; // 单手势
    const el = e.currentTarget;
    if (e.pointerType === 'mouse') el.setPointerCapture?.(e.pointerId); // touch/pen 有隐式捕获；jsdom 无此方法，可选调用
    dragRef.current = { id: c.id, from: index, index, el, startPointer: axisCoord(e, axis) };
    gesture.pointerDown(e);
  };

  // 渲染：拖动项保持原位（半透明），指示线插在「最终下标」对应的空隙
  const rendered: ReactNode[] = [];
  let nonDragged = 0;
  chains.forEach((c, index) => {
    if (indicator && c.id !== indicator.id && nonDragged === indicator.index) {
      rendered.push(<DropIndicator key="__drop-indicator" axis={axis} />);
    }
    if (c.id !== indicator?.id) nonDragged++;
    rendered.push(
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
          className={(args) => `${itemClassName(args)}${indicator?.id === c.id ? ' opacity-50' : ''}`}
          onPointerDown={onItemPointerDown(c, index)}
          onPointerMove={(e) => gesture.pointerMove(e)}
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
          <ChainMark chainId={c.id} color={c.color} icon={c.icon} size={16} />
          <span className="truncate">{c.name}</span>
        </NavLink>
      </ContextMenu>,
    );
  });
  if (indicator && nonDragged === indicator.index) {
    rendered.push(<DropIndicator key="__drop-indicator" axis={axis} />);
  }
  return <>{rendered}</>;
});
