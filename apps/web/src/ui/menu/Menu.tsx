import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  Dialog as AriaDialog,
  Header as RACHeader,
  Heading,
  Menu as RACMenu,
  MenuItem as RACMenuItem,
  MenuSection as RACMenuSection,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Pressable,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';
import { FloatingLayer } from '../floating/FloatingLayer';
import { Icon } from '../Icon';

// Menu 家族（规范：docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md）
//
// ResponsiveMenu 对业务暴露一套命令集合，形态由组件内部决定（规范 §3）：
//   ≥ 768px：Trigger → 锚定 Menu（FloatingLayer 承载）
//   < 768px：Trigger → 模态 ActionSheet（内部组件，永不公开导出）
// 调用方不读视口宽度；打开期间跨越 767/768 边界直接关闭并复焦 Trigger。
//
// 键盘与可访问性全部落在 react-aria-components 的 MenuTrigger / Menu 上：
// role="menu"、ArrowDown/ArrowUp 开在首/末启用项、字母导航（textValue）、
// Home/End、Escape 关闭并复焦 Trigger；本文件不挂 window 级键盘监听。
// ActionSheet 复用 Modal 行为层（滚动锁、inert、焦点圈禁），但保持独立的
// 短命令几何与 Menu 语义（规范 §10）。
//
// 视觉只消费 tokens.css 经 Tailwind 语义映射发布的 token：
// min-w-menu / max-w-menu / rounded-menu(-item) / p-menu / px-menu-item /
// h-menu-item / gap-menu-icon / h-menu-icon / w-menu-icon /
// rounded-action-sheet(-item) / p-action-sheet / h-action-sheet-item /
// bg-floating-bg / bg-floating-hover / bg-floating-pressed /
// bg-floating-danger-soft / border-floating-edge / shadow-floating /
// shadow-action-sheet / z-floating / z-overlay，动效 duration var(--ease-out)。

/** 桌面 Menu / 移动 ActionSheet 共享的项几何上下文，业务不可见。 */
type MenuSurface = 'menu' | 'sheet';
const MenuSurfaceContext = createContext<MenuSurface>('menu');

/** 危险项的 DOM 标记：ActionSheet 初始聚焦跳过危险项（规范 §7.3）。 */
const DANGER_ITEM_CLASS = 'moment-menuitem-danger';

const MENU_SURFACE_CLASS =
  'min-w-menu max-w-menu rounded-menu border border-floating-edge bg-floating-bg p-menu shadow-floating z-floating outline-none ' +
  'motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--ease-out)] ' +
  'data-[entering]:opacity-0 data-[exiting]:opacity-0 data-[entering]:motion-safe:-translate-y-1';

const DESKTOP_QUERY = '(min-width: 768px)';

/** 响应式断点只由本文件读取（规范 §3：业务不读视口宽度）。 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

export type MenuItemProps = {
  id: Key;
  /** 字母导航与可访问名称的稳定文本（规范 §7.2） */
  textValue: string;
  /** 可选图标，固定 16px，继承当前状态颜色（规范 §6.2） */
  icon?: LucideIcon;
  /** danger 只改变文字与图标颜色，默认无红底（规范 §6.3） */
  tone?: 'default' | 'danger';
  isDisabled?: boolean;
  /** 禁用原因的简短尾部文本，与命令建立可访问关联（规范 §6.3） */
  disabledReason?: string;
  /** 普通等宽数字计数，不做高饱和 Badge（规范 §6.2） */
  count?: number;
  /** 键盘快捷键提示，只在桌面 Menu 显示（规范 §6.2） */
  shortcut?: string;
  children: ReactNode;
};

type InternalItemProps = MenuItemProps & { href?: string };

function MenuItemView({
  id,
  textValue,
  icon,
  tone = 'default',
  isDisabled = false,
  disabledReason,
  count,
  shortcut,
  href,
  children,
}: InternalItemProps) {
  const surface = useContext(MenuSurfaceContext);
  const reasonId = useId();
  const geometry =
    surface === 'menu'
      ? 'h-menu-item rounded-menu-item text-sm'
      : 'h-action-sheet-item rounded-action-sheet-item text-base';
  return (
    <RACMenuItem
      id={id}
      textValue={textValue}
      isDisabled={isDisabled}
      href={href}
      aria-describedby={isDisabled && disabledReason ? reasonId : undefined}
      className={({ isDisabled: disabled }) => {
        const palette = disabled
          ? 'text-muted'
          : tone === 'danger'
            ? `text-danger ${DANGER_ITEM_CLASS} data-[hovered]:bg-floating-danger-soft data-[pressed]:bg-floating-danger-soft data-[focus-visible]:bg-floating-danger-soft`
            : 'text-ink data-[hovered]:bg-floating-hover data-[pressed]:bg-floating-pressed data-[focus-visible]:bg-floating-hover';
        return (
          'flex w-full cursor-default select-none items-center gap-menu-icon px-menu-item text-left font-medium outline-none ' +
          'data-[focus-visible]:ring-focus data-[focus-visible]:ring-inset ' +
          `${geometry} ${palette}`
        );
      }}
    >
      {icon ? (
        <Icon icon={icon} className="h-menu-icon w-menu-icon shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1">{children}</span>
      {isDisabled && disabledReason ? (
        <span id={reasonId} className="shrink-0 text-caption text-muted">
          {disabledReason}
        </span>
      ) : null}
      {!isDisabled && count !== undefined ? (
        <span className="shrink-0 text-meta tabular-nums text-muted">
          {count}
        </span>
      ) : null}
      {!isDisabled && shortcut && surface === 'menu' ? (
        <span className="shrink-0 text-meta text-muted">{shortcut}</span>
      ) : null}
    </RACMenuItem>
  );
}

/** 立即执行命令（规范 §6.1）。 */
export function MenuItem(props: MenuItemProps) {
  return <MenuItemView {...props} />;
}

export type MenuLinkItemProps = MenuItemProps & { href: string };

/** 链接语义的命令：进入页面而不是执行动作，渲染原生链接（规范 §6.1）。 */
export function MenuLinkItem(props: MenuLinkItemProps) {
  return <MenuItemView {...props} />;
}

export type MenuGroupProps = {
  /** 两个以上分组时的可选短标题（规范 §4.1） */
  label?: string;
  children: ReactNode;
};

/** 对相关操作分组：只用留白与可选标题，不使用分割线（规范 §3 / §4.1）。 */
export function MenuGroup({ label, children }: MenuGroupProps) {
  return (
    <RACMenuSection className="mt-2 first:mt-0">
      {label ? (
        <RACHeader className="px-menu-item py-1 text-caption text-muted">
          {label}
        </RACHeader>
      ) : null}
      {children}
    </RACMenuSection>
  );
}

type ActionSheetProps = {
  /** 命令集合的可访问名称 */
  label: string;
  /** 标题命名当前对象（规范 §14），同时作为浮面的可访问名称 */
  title?: string;
  /** 可选对象上下文，如“周末小家 · simon”（规范 §4.2） */
  context?: ReactNode;
  onClose(): void;
  onAction?(key: Key): void;
  children: ReactNode;
};

// ActionSheet 是 ResponsiveMenu 的移动端内部分支，永不公开导出（规范 §2）。
// 模态行为（Scrim、滚动锁、inert、焦点圈禁与恢复、Escape）由 RAC Modal 提供；
// 几何是独立的短命令面：底部贴合视口 + Safe Area，不做四周悬浮卡片（规范 §5.3）。
function ActionSheet({
  label,
  title,
  context,
  onClose,
  onAction,
  children,
}: ActionSheetProps) {
  // 初始聚焦首个非危险操作，不自动聚焦危险项（规范 §7.3）。
  // ActionSheet 随 MenuTrigger 常驻挂载、Modal 打开时才插入 dialog 节点，
  // 因此用 callback ref 在 dialog 真正挂载时调度；RAC 命令集合需要第二趟
  // 渲染才把菜单项挂进 DOM，FocusScope 的自动聚焦也在挂载后的被动 effect
  // 中落地，这里等到下一帧统一归正。焦点已在作用域内时 FocusScope 不会再
  // 抢占，因此归正结果稳定。
  const focusFirstSafeItem = (root: HTMLElement) => {
    requestAnimationFrame(() => {
      if (!root.isConnected) return;
      const active = document.activeElement;
      const onItem =
        active instanceof HTMLElement &&
        root.contains(active) &&
        active.getAttribute('role') === 'menuitem';
      if (onItem && !active.classList.contains(DANGER_ITEM_CLASS)) return;
      root
        .querySelector<HTMLElement>(
          `[role="menuitem"]:not(.${DANGER_ITEM_CLASS})`,
        )
        ?.focus();
    });
  };

  return (
    <ModalOverlay
      isDismissable
      className="fixed top-0 left-0 flex h-dvh w-screen items-end z-overlay bg-scrim"
      data-testid="action-sheet-scrim"
    >
      <Modal className="flex max-h-full w-full flex-col outline-none">
        <AriaDialog
          ref={(node) => {
            if (node) focusFirstSafeItem(node);
          }}
          aria-label={title ?? label}
          className="flex max-h-full w-full flex-col overflow-hidden rounded-action-sheet bg-floating-bg p-action-sheet pb-[calc(var(--action-sheet-padding)+var(--action-sheet-safe-bottom))] shadow-action-sheet outline-none"
        >
          {title ? (
            <Heading
              slot="title"
              className="px-menu-item text-base font-medium text-ink"
            >
              {title}
            </Heading>
          ) : null}
          {context ? (
            <div className="px-menu-item pt-1 text-meta text-muted">
              {context}
            </div>
          ) : null}
          <MenuSurfaceContext.Provider value="sheet">
            <RACMenu
              aria-label={label}
              onAction={onAction}
              className="mt-2 outline-none"
            >
              {children}
            </RACMenu>
          </MenuSurfaceContext.Provider>
          {/* “取消”是独立的最后点击区，通过留白与命令区分，不画分割线（规范 §4.2） */}
          <button
            type="button"
            onClick={onClose}
            className="mt-2 flex h-action-sheet-item w-full shrink-0 items-center justify-center rounded-action-sheet-item text-base font-medium text-ink transition-colors duration-[var(--ease)] hover:bg-floating-hover focus-visible:outline-none focus-visible:ring-focus"
          >
            取消
          </button>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type ResponsiveMenuProps = {
  /** 命令集合的可访问名称 */
  'aria-label': string;
  /** ActionSheet 标题：命名当前对象（规范 §14）；缺省回退 aria-label */
  sheetTitle?: string;
  /** ActionSheet 可选对象上下文（规范 §4.2） */
  sheetContext?: ReactNode;
  /** 通常是 IconButton；aria-haspopup / aria-expanded 由组件负责 */
  trigger: ReactElement;
  /** 选择命令后的回调；关闭与焦点恢复由组件负责（规范 §12.1） */
  onAction?(key: Key): void;
  children: ReactNode;
};

/**
 * 一组立即执行的命令（规范 §3）：≥768px 锚定 Menu，<768px 模态 ActionSheet。
 * 业务不读视口宽度，也不分别维护两种命令。
 */
export function ResponsiveMenu({
  'aria-label': ariaLabel,
  sheetTitle,
  sheetContext,
  trigger,
  onAction,
  children,
}: ResponsiveMenuProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const triggerRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  // 打开期间跨越 767/768 边界：直接关闭当前浮层并复焦 Trigger，
  // 不在屏幕中间变形（规范 §3）。
  useEffect(() => {
    if (!openRef.current) return;
    setOpen(false);
    triggerRef.current?.focus();
  }, [isDesktop]);

  // 选择普通命令后先关闭浮层，再执行业务动作（规范 §7.3）。
  const handleAction = (key: Key) => {
    setOpen(false);
    onAction?.(key);
  };

  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      {/* Pressable 的类型只认宿主元素；运行时它用 cloneElement 把按压事件、
          菜单键控（ArrowDown/ArrowUp/Enter/Space）与 ref 合入任何转发 ref 的
          组件。IconButton 经 ...rest 与 React 19 的 ref-as-prop 透传。 */}
      <Pressable ref={triggerRef}>
        {trigger as ComponentProps<typeof Pressable>['children']}
      </Pressable>
      {isDesktop ? (
        <FloatingLayer
          open={open}
          onOpenChange={setOpen}
          triggerRef={triggerRef}
          className={MENU_SURFACE_CLASS}
        >
          <MenuSurfaceContext.Provider value="menu">
            {/* Tab 离开 Menu 时关闭，不在非 Modal Menu 内制造焦点陷阱（规范 §7.1） */}
            <div
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            >
              <RACMenu
                aria-label={ariaLabel}
                onAction={handleAction}
                className="outline-none"
              >
                {children}
              </RACMenu>
            </div>
          </MenuSurfaceContext.Provider>
        </FloatingLayer>
      ) : (
        <ActionSheet
          label={ariaLabel}
          title={sheetTitle}
          context={sheetContext}
          onClose={() => setOpen(false)}
          onAction={handleAction}
        >
          {children}
        </ActionSheet>
      )}
    </MenuTrigger>
  );
}

export type ContextMenuProps = {
  /** 命令集合的可访问名称 */
  'aria-label': string;
  onAction?(key: Key): void;
  /** 与 ResponsiveMenu 共享的同一批命令（MenuItem / MenuGroup） */
  items: ReactNode;
  children: ReactNode;
};

/**
 * 桌面右键 / Shift+F10 的快捷入口（规范 §7.4）：复用 Menu 键盘模型。
 * 只提供快捷路径；移动端的可见入口由调用方用 ResponsiveMenu 提供，
 * 本组件不响应长按。Outside Click / Escape / 焦点恢复由 FloatingLayer 负责。
 */
export function ContextMenu({
  'aria-label': ariaLabel,
  onAction,
  items,
  children,
}: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  // 右键没有可锚定的元素：在指针坐标放一枚零尺寸的虚拟锚点供 FloatingLayer 定位
  const anchorRef = useRef<HTMLSpanElement>(null);

  const openAt = (x: number, y: number) => {
    setPoint({ x, y });
    setOpen(true);
  };

  const handleAction = (key: Key) => {
    setOpen(false);
    onAction?.(key);
  };

  return (
    <div
      className="contents"
      onContextMenu={(event) => {
        event.preventDefault();
        openAt(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (
          (event.key === 'F10' && event.shiftKey) ||
          event.key === 'ContextMenu'
        ) {
          event.preventDefault();
          const target =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : event.currentTarget;
          const rect = target.getBoundingClientRect();
          openAt(rect.left, rect.bottom);
        }
      }}
    >
      {children}
      {point ? (
        <>
          <span
            ref={anchorRef}
            aria-hidden
            className="fixed h-0 w-0"
            style={{ left: point.x, top: point.y }}
          />
          <FloatingLayer
            open={open}
            onOpenChange={setOpen}
            triggerRef={anchorRef}
            placement="bottom start"
            className={MENU_SURFACE_CLASS}
          >
            <MenuSurfaceContext.Provider value="menu">
              <div
                onKeyDown={(event) => {
                  if (event.key === 'Tab') {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
              >
                <RACMenu
                  aria-label={ariaLabel}
                  onAction={handleAction}
                  onClose={() => setOpen(false)}
                  autoFocus="first"
                  className="outline-none"
                >
                  {items}
                </RACMenu>
              </div>
            </MenuSurfaceContext.Provider>
          </FloatingLayer>
        </>
      ) : null}
    </div>
  );
}
