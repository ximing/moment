import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';

// Button 家族基元（规范：docs/superpowers/specs/2026-08-18-web-button-design.md）
// 视觉只消费 styles/tokens.css 经 Tailwind 语义映射发布的 token：
// 几何 h-control / h-control-prominent / px-button / px-button-pill / rounded-button /
// gap-button-icon / h-icon-button / w-icon-button，状态色 action / danger / floating-hover /
// floating-danger-soft，焦点环 ring-focus / ring-offset-focus，按压 scale-button-pressed，
// 禁用 opacity-button-disabled，动效 duration var(--ease)（reduced-motion 下 token 降为 1ms，
// 按压缩放另由 motion-safe 门控）。

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonShape = 'standard' | 'pill';

// danger 固定 standard：不可逆动作不做成轻快胶囊（规范 §3.2），类型层直接拒绝组合。
type VariantShapeProps =
  | { variant?: 'primary' | 'secondary' | 'quiet'; shape?: ButtonShape }
  | { variant: 'danger'; shape?: 'standard' };

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // 实心动作色；hover 色面加深约 6%（向墨色混合，深浅主题均保持层级）
  primary:
    'bg-action text-action-fg hover:bg-[color-mix(in_srgb,var(--action)_94%,var(--ink))]',
  // 约 7% 暖墨色面，无描边（规范 §3.1）
  secondary:
    'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] text-ink hover:bg-[color-mix(in_srgb,var(--ink)_9%,transparent)]',
  // 透明低强调；hover 出现轻色面并提升至墨色
  quiet: 'bg-transparent text-muted hover:bg-floating-hover hover:text-ink',
  // 最终且不可逆确认的实心危险色
  danger:
    'bg-danger text-danger-fg hover:bg-[color-mix(in_srgb,var(--danger)_94%,var(--ink))]',
};

const SHAPE_CLASSES: Record<ButtonShape, string> = {
  standard: 'h-control rounded-button px-button',
  pill: 'h-control-prominent rounded-full px-button-pill',
};

const BASE_CLASSES =
  'inline-flex shrink-0 select-none items-center justify-center gap-button-icon whitespace-nowrap text-sm font-medium ' +
  'transition-[background-color,color,transform] duration-[var(--ease)] ' +
  'focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg ' +
  'motion-safe:active:scale-button-pressed ' +
  'disabled:pointer-events-none disabled:opacity-button-disabled';

// Loading spinner：占据 leading icon 槽位（规范 §4），16px 继承当前文字颜色；
// reduced-motion 下保留识别“进行中”所需的最小旋转，不做额外动画。
function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> &
  VariantShapeProps & {
    /** 进行中状态：置 aria-busy、显示 spinner 并抑制 onClick 重复触发 */
    loading?: boolean;
    /** 添加、上传、删除等带明确对象的动作；与 trailingIcon 不得同时使用（规范 §4） */
    leadingIcon?: LucideIcon;
    /** 仅用于进入、下一步或外部跳转等方向动作 */
    trailingIcon?: LucideIcon;
    /** 只承担宽度与外部对齐（如 w-full、self-end）；不得覆盖高度、内边距、圆角、颜色与状态 */
    className?: string;
    children: ReactNode;
  };

export function Button({
  variant = 'primary',
  shape = 'standard',
  loading = false,
  leadingIcon,
  trailingIcon,
  type = 'button',
  disabled,
  onClick,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  // Loading 不是 Disabled 的静态样式（规范 §6）：保留原色面与焦点能力，
  // 但通过摘除 onClick 阻止重复提交，语义交给 aria-busy。
  const handleClick: MouseEventHandler<HTMLButtonElement> | undefined = loading
    ? undefined
    : onClick;

  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={`${BASE_CLASSES} ${SHAPE_CLASSES[shape]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Spinner />
      ) : leadingIcon ? (
        <Icon icon={leadingIcon} />
      ) : null}
      {children}
      {!loading && trailingIcon ? <Icon icon={trailingIcon} /> : null}
    </button>
  );
}

export type ButtonLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'children' | 'shape'
> &
  VariantShapeProps & {
    leadingIcon?: LucideIcon;
    trailingIcon?: LucideIcon;
    /** 同 Button：只承担宽度与外部对齐 */
    className?: string;
    children: ReactNode;
  };

/** 以按钮外观表达导航语义：渲染原生链接，绝不用 button 包裹 a（规范 §9）。 */
export function ButtonLink({
  variant = 'primary',
  shape = 'standard',
  leadingIcon,
  trailingIcon,
  className = '',
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a
      className={`${BASE_CLASSES} ${SHAPE_CLASSES[shape]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {leadingIcon ? <Icon icon={leadingIcon} /> : null}
      {children}
      {trailingIcon ? <Icon icon={trailingIcon} /> : null}
    </a>
  );
}

type IconButtonVariant = 'quiet' | 'secondary' | 'danger';

const ICON_VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  quiet: 'bg-transparent text-muted hover:bg-floating-hover hover:text-ink',
  secondary:
    'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] text-ink hover:bg-[color-mix(in_srgb,var(--ink)_9%,transparent)]',
  // 危险入口只用危险色文字与低强调面（规范 §3.1），实心 danger 留给最终确认 Button
  danger: 'bg-transparent text-danger hover:bg-floating-danger-soft',
};

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> & {
  icon: LucideIcon;
  /** 可访问名称，必须可读；不能只依赖 Tooltip（规范 §7 / §10） */
  label: string;
  variant?: IconButtonVariant;
  /** 同 Button：只承担外部对齐 */
  className?: string;
};

/** 更多、关闭、添加媒体等空间明确的图标动作；始终为圆形，不跟随 shape（规范 §3.2）。 */
export function IconButton({
  icon,
  label,
  variant = 'quiet',
  type = 'button',
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`${BASE_CLASSES} h-icon-button w-icon-button rounded-full ${ICON_VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      <Icon icon={icon} />
    </button>
  );
}
