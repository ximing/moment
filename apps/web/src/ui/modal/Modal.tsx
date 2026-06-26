import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import {
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';
import { X } from 'lucide-react';
// 注意：必须显式指向 barrel 文件。src/ui/ 下同时存在遗留的 Button.tsx
// 与 button/ 目录，大小写不敏感文件系统上 '../button' 会优先解析到
// 遗留 Button.tsx（只导出 Button，没有 IconButton），运行时直接崩；
// 待遗留文件清理后才能改回裸目录导入。
import { Button, IconButton } from '../button/index';

// Modal 家族（规范：docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md）
// 视觉只消费 styles/tokens.css 经 Tailwind 语义映射发布的 overlay token：
// 遮罩 bg-scrim / bg-scrim-nested，层级 z-overlay / z-overlay-nested，
// 几何 max-w-dialog / max-w-alert-dialog / w-sheet、rounded-overlay /
// rounded-sheet-mobile、p-overlay / p-overlay-mobile、gap-overlay-action、
// top-sheet-mobile-top / top-overlay-gap / right-overlay-gap / bottom-overlay-gap，
// 阴影 shadow-overlay。
// 动效（规范 §11）挂在 RAC 的 data-entering / data-exiting 态上，keyframes 在
// tokens.css：Scrim 透明度 160ms；Dialog/AlertDialog 上移 8px + scale 0.98→1
// 180ms（退出 120ms 略快）；Sheet <768px 底部、≥768px 右侧 220ms（退出 160ms）。
// RAC Modal 的 useExitAnimation 通过 getAnimations() 自动延迟卸载到退出动画
// 播完，业务把 open 置 false 才会进入退出（不在业务完成前提前卸载）；
// reduced-motion 由 motion-reduce:animate-none 取消位移与缩放，只留即时显隐
// （此时 getAnimations 为空，RAC 同步卸载）。
// 行为层全部落在 react-aria-components 的 Modal/Dialog：portal、焦点圈禁与恢复、
// 背景 inert、滚动锁由它统一负责；本目录不挂任何 window 级键盘监听，
// Escape 通过浮层内的 React keydown 链转译为关闭原因。

/** onRequestClose 的关闭来源（规范 §9）：基础组件只报告意图，业务决定关闭、确认或忽略。 */
export type CloseReason = 'close-button' | 'escape' | 'outside';

type ModalSurfaceVariant = 'dialog' | 'sheet' | 'alert';

type ModalSurfaceProps = {
  open: boolean;
  variant: ModalSurfaceVariant;
  /** 进行中：抑制全部关闭请求并标记 aria-busy（规范 §9 / §12） */
  busy?: boolean;
  /** AlertDialog 传 false：外部点击不关闭（规范 §9） */
  dismissable?: boolean;
  onRequestClose(reason: CloseReason): void;
  children: ReactNode;
};

// ModalSurface 是目录私有实现细节：不进 index.ts，业务方永不 import（规范 §14）。
function ModalSurface({
  open,
  variant,
  busy = false,
  dismissable = true,
  onRequestClose,
  children,
}: ModalSurfaceProps) {
  const requestClose = (reason: CloseReason) => {
    if (busy) return;
    onRequestClose(reason);
  };
  // 原生 keydown 监听在挂载时绑定一次，通过 ref 读取最新的 requestClose，
  // 避免 busy 变化时重复绑定（ref 只在 effect 中写入，不在渲染期访问）。
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  // 焦点被 react-aria 圈禁在浮层内，Escape 一定来自浮层内部。react-aria 自身
  // 的键盘关闭已用 isKeyboardDismissDisabled 关闭（否则它的处理会混进
  // onOpenChange，无法与 outside 区分）；RAC Dialog 又不下传 onKeyDown prop，
  // 所以这里在 dialog 元素上挂元素级原生 keydown（非 window 级监听），把
  // Escape 统一转译为关闭原因。
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current('escape');
      }
    };
    node.addEventListener('keydown', handleKeyDown);
    return () => node.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // RAC Dialog 的 filterDOMProps 会丢弃 aria-busy，改为在元素上直接维护
  // （规范 §12：busy 要有可访问的 Busy 标记）。
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (busy) node.setAttribute('aria-busy', 'true');
    else node.removeAttribute('aria-busy');
  }, [busy, open]);

  // 外部点击由 react-aria 的 isDismissable 交互识别，经 onOpenChange 转译为
  // outside 原因；Escape 已在上方拦截，不会走到这里。
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) requestCloseRef.current('outside');
  };

  const overlayClass =
    variant === 'alert'
      ? 'z-overlay-nested bg-scrim-nested flex items-center justify-center p-4'
      : variant === 'sheet'
        ? 'z-overlay bg-scrim'
        : 'z-overlay bg-scrim flex items-center justify-center p-4';

  // Sheet 是单一组件（规范 §5.2 / §5.3）：<768px 底部近全高、只留顶部圆角与
  // 10px 呼吸区；≥768px 经 md: 媒体查询类切换为右侧 12px 间距的 520px 浮层。
  // 页面不传 side，也不自行判断设备。
  const modalClass =
    variant === 'sheet'
      ? 'absolute inset-x-0 bottom-0 top-sheet-mobile-top flex flex-col md:left-auto md:top-overlay-gap md:right-overlay-gap md:bottom-overlay-gap md:w-sheet'
      : `flex max-h-full w-full flex-col ${variant === 'alert' ? 'max-w-alert-dialog' : 'max-w-dialog'}`;

  const surfaceClass =
    variant === 'sheet'
      ? 'rounded-sheet-mobile md:rounded-overlay'
      : 'rounded-overlay';

  // 动效（规范 §11）：Scrim 透明度 160ms 双向；Dialog/AlertDialog 上移 8px +
  // scale 0.98→1，进入 180ms ease-out、退出 120ms ease-in；Sheet 移动端底部、
  // 桌面右侧进出，进入 220ms、退出 160ms。reduced-motion 取消位移与缩放。
  const scrimMotionClass =
    'data-[entering]:animate-[moment-scrim-in_160ms_ease-out] ' +
    'data-[exiting]:animate-[moment-scrim-out_160ms_ease-in] ' +
    'motion-reduce:data-[entering]:animate-none motion-reduce:data-[exiting]:animate-none';

  const modalMotionClass =
    variant === 'sheet'
      ? 'data-[entering]:animate-[moment-sheet-in-bottom_220ms_ease-out] ' +
        'md:data-[entering]:animate-[moment-sheet-in-right_220ms_ease-out] ' +
        'data-[exiting]:animate-[moment-sheet-out-bottom_160ms_ease-in] ' +
        'md:data-[exiting]:animate-[moment-sheet-out-right_160ms_ease-in] ' +
        'motion-reduce:data-[entering]:animate-none motion-reduce:data-[exiting]:animate-none'
      : 'data-[entering]:animate-[moment-dialog-in_180ms_ease-out] ' +
        'data-[exiting]:animate-[moment-dialog-out_120ms_ease-in] ' +
        'motion-reduce:data-[entering]:animate-none motion-reduce:data-[exiting]:animate-none';

  return (
    <ModalOverlay
      isOpen={open}
      isDismissable={dismissable && !busy}
      isKeyboardDismissDisabled
      onOpenChange={handleOpenChange}
      className={`fixed top-0 left-0 h-dvh w-screen ${overlayClass} ${scrimMotionClass}`}
      data-testid="modal-scrim"
    >
      <Modal className={`${modalClass} ${modalMotionClass} outline-none`}>
        <AriaDialog
          ref={dialogRef}
          role={variant === 'alert' ? 'alertdialog' : undefined}
          className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface p-overlay-mobile shadow-overlay outline-none md:p-overlay ${surfaceClass}`}
        >
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export type DialogProps = {
  open: boolean;
  /** 用户任务式标题，同时作为可访问名称（规范 §13 / §10） */
  title: string;
  /** 可选上下文（如链色点与链名）；不复制页面完整页眉（规范 §7） */
  context?: ReactNode;
  /** Quiet / Primary 或 Danger 操作区；遵循 Button 规范 */
  footer?: ReactNode;
  busy?: boolean;
  onRequestClose(reason: CloseReason): void;
  children: ReactNode;
};

type StructuredSurfaceProps = DialogProps & {
  variant: 'dialog' | 'sheet';
};

// Dialog 与 Sheet 共用固定三段结构：Header（Title / optional context / Close）、
// Body（唯一滚动区）、Footer（规范 §7 / §8）。
function StructuredSurface({
  variant,
  open,
  title,
  context,
  footer,
  busy = false,
  onRequestClose,
  children,
}: StructuredSurfaceProps) {
  const requestClose = (reason: CloseReason) => {
    if (busy) return;
    onRequestClose(reason);
  };

  return (
    <ModalSurface
      open={open}
      variant={variant}
      busy={busy}
      onRequestClose={onRequestClose}
    >
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Heading
            slot="title"
            className="text-lg font-semibold text-ink"
          >
            {title}
          </Heading>
          {context ? (
            <div className="mt-1 text-meta text-muted">{context}</div>
          ) : null}
        </div>
        <IconButton
          icon={X}
          label="关闭"
          onClick={() => requestClose('close-button')}
        />
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer ? (
        <div className="mt-6 flex shrink-0 justify-end gap-overlay-action">
          {footer}
        </div>
      ) : null}
    </ModalSurface>
  );
}

/** 居中有限面板：创建链、简短表单（规范 §2）。 */
export function Dialog(props: DialogProps) {
  return <StructuredSurface {...props} variant="dialog" />;
}

export type SheetProps = DialogProps;

/** 桌面右侧浮层、<768px 底部近全高：记下／编辑时刻、移动端时间索引（规范 §2）。 */
export function Sheet(props: SheetProps) {
  return <StructuredSurface {...props} variant="sheet" />;
}

export type AlertDialogProps = {
  open: boolean;
  title: string;
  /** 说明真实后果与是否可恢复，不重复标题（规范 §13） */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** 最终不可逆操作：确认按钮使用实心危险色（规范 §7） */
  danger?: boolean;
  /** 危险操作执行中：禁止关闭与重复提交（规范 §9 / §12） */
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
};

/** 居中小确认面板：放弃草稿、删除、转让、撤销（规范 §2）。无右上角关闭按钮，
 * 外部点击不关闭，Escape 等价于更安全的取消操作，初始聚焦取消按钮。 */
export function AlertDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  return (
    <ModalSurface
      open={open}
      variant="alert"
      busy={busy}
      dismissable={false}
      onRequestClose={(reason) => {
        // AlertDialog 只会收到 escape（outside 已被 dismissable 关闭，
        // 且没有 close-button）；Escape 等价于更安全的次级操作（规范 §9）
        if (reason === 'escape') onCancel();
      }}
    >
      <Heading slot="title" className="text-lg font-semibold text-ink">
        {title}
      </Heading>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <div className="mt-6 flex shrink-0 justify-end gap-overlay-action">
        {/* 初始聚焦更安全的次级操作（规范 §10）：DOM 顺序即 Tab 顺序，
            autoFocus 让焦点落在取消而不是危险确认上 */}
        <Button variant="quiet" disabled={busy} autoFocus onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalSurface>
  );
}
