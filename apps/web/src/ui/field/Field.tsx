import {
  CalendarDateTime,
  parseDateTime,
  type DateValue,
} from '@internationalized/date';
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import type {
  ComponentProps,
  FocusEvent,
  ReactNode,
} from 'react';
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Button as RACButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  FieldError as RACFieldError,
  Heading,
  I18nProvider,
  Input as RACInput,
  Label,
  ListBox,
  ListBoxItem,
  Popover as RACPopover,
  Select as RACSelect,
  SelectValue,
  Text as RACText,
  TextArea as RACTextArea,
  TextField as RACTextField,
} from 'react-aria-components';
import { Icon } from '../Icon';
// 注意：必须显式指向 barrel 文件。src/ui/ 下同时存在遗留的 Field.tsx 等
// 同名文件，大小写不敏感文件系统上裸目录导入可能解析到遗留文件。
import { Popover } from '../popover/index';

// Field 家族（规范：docs/superpowers/specs/2026-08-18-web-field-input-design.md）
// 视觉只消费 styles/tokens.css 经 Tailwind 语义映射发布的 field token：
// 色面 bg-field-bg / hover:bg-field-bg-hover / disabled:bg-field-bg-disabled，
// 文字 text-ink / placeholder:text-field-placeholder，状态环
// ring-field（--field-ring-w 2px）+ ring-field-focus / ring-field-danger，
// 几何 h-field（44px）/ rounded-field / px-field / text-[length:var(--field-text-size)]（16px）/
// min-h-textarea（112px）/ w-[var(--field-end-hit)]，Label 14px、Support 13px，
// 行距 gap-field-label。Autofill 以 inset 大阴影映射回 --field-bg（1000px 是
// 覆盖 UA 底色的技术常量，不是设计尺寸）。不开放 size/radius/tone variant；
// className 只承担外部宽度与布局。

// ---------------------------------------------------------------------------
// 共享视觉
// ---------------------------------------------------------------------------

const CONTROL_SURFACE_CLASS =
  'w-full min-w-0 rounded-field bg-field-bg px-field text-[length:var(--field-text-size)] text-ink caret-ink ' +
  'placeholder:text-field-placeholder outline-none ' +
  'transition-[background-color,box-shadow] duration-[var(--ease)] ' +
  'hover:bg-field-bg-hover read-only:hover:bg-field-bg ' +
  'focus-visible:ring-field focus-visible:ring-field-focus ' +
  'aria-invalid:ring-field aria-invalid:ring-field-danger ' +
  'disabled:cursor-not-allowed disabled:bg-field-bg-disabled disabled:text-muted disabled:hover:bg-field-bg-disabled ' +
  // Autofill：UA 底色用 inset 大阴影压回 --field-bg，文字颜色同步恢复
  'autofill:shadow-[inset_0_0_0_1000px_var(--field-bg)] autofill:[-webkit-text-fill-color:var(--ink)]';

const LABEL_CLASS = 'text-[length:var(--field-label-size)] font-medium text-ink';
const SUPPORT_CLASS = 'text-[length:var(--field-support-size)]';

// ---------------------------------------------------------------------------
// 基础层
// ---------------------------------------------------------------------------

/** isInvalid 与 errorMessage 成对使用（规范 §8），类型层直接拒绝裸 errorMessage。 */
type ValidationProps =
  | { isInvalid: true; errorMessage: string }
  | { isInvalid?: false; errorMessage?: undefined };

function FieldLabelRow({
  label,
  isOptional,
}: {
  label: string;
  isOptional?: boolean;
}) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <Label className={LABEL_CLASS}>{label}</Label>
      {/* “可选”统一在 Label 行右侧，只由 isOptional 渲染（规范 §3） */}
      {isOptional ? (
        <span className={`${SUPPORT_CLASS} text-muted`}>可选</span>
      ) : null}
    </span>
  );
}

export function FieldDescription({ children }: { children: ReactNode }) {
  return (
    <RACText slot="description" className={`${SUPPORT_CLASS} text-muted`}>
      {children}
    </RACText>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return (
    <RACFieldError className={`${SUPPORT_CLASS} text-field-danger`}>
      {children}
    </RACFieldError>
  );
}

/** Error 替换 Description，共享同一支持信息区（规范 §3/§6.2）。 */
function FieldSupport({
  description,
  isInvalid,
  errorMessage,
}: {
  description?: string;
  isInvalid?: boolean;
  errorMessage?: string;
}) {
  if (isInvalid && errorMessage) return <FieldError>{errorMessage}</FieldError>;
  if (description) return <FieldDescription>{description}</FieldDescription>;
  return null;
}

/** 接近硬上限的阈值（规范 §7.4：读屏提示只在接近上限时进入）。 */
const CHARACTER_COUNT_NEAR_RATIO = 0.9;

/**
 * Character Count（规范 §3/§7.4）：Support 区右侧、不覆盖控件内容，
 * 只由存在明确 maxLength 的字段渲染。视觉常显；读屏节流——只有达到
 * 90% 才挂载 polite live region 状态文本，避免逐字播报。
 */
function CharacterCount({ value, max }: { value: number; max: number }) {
  const nearLimit = value >= max * CHARACTER_COUNT_NEAR_RATIO;
  return (
    <span
      data-character-count
      className={`${SUPPORT_CLASS} shrink-0 tabular-nums text-muted`}
    >
      <span aria-hidden="true">
        {value}/{max}
      </span>
      {nearLimit ? (
        <span role="status" className="sr-only">
          {`还可输入 ${max - value} 字`}
        </span>
      ) : null}
    </span>
  );
}

export type FieldProps = {
  label: string;
  isRequired?: boolean;
  isOptional?: boolean;
  description?: string;
  /** 与 errorMessage 成对使用：仅有错误文案不绕过 invalid 状态（规范 §8） */
  isInvalid?: boolean;
  errorMessage?: string;
  /** Support 区右侧槽位（规范 §3：Character Count）；不进入 aria-describedby */
  supportEnd?: ReactNode;
  /** 只承担 Field 外部宽度与布局，不覆盖内部色面、圆角、高度、间距与状态 */
  className?: string;
  children: ReactNode;
};

/**
 * 基础 Field：Label、可选标记、Description/Error 与控件的稳定 ID 关联
 * 由 react-aria-components TextField 上下文提供。结构顺序固定
 * Label → Control → Support（规范 §3）；Support 区内 Description/Error
 * 居左，supportEnd（如 Character Count）居右，同一行位不堆叠。
 */
export function Field({
  label,
  isRequired,
  isOptional,
  description,
  isInvalid,
  errorMessage,
  supportEnd,
  className = '',
  children,
}: FieldProps) {
  const hasSupport = !!(isInvalid && errorMessage) || !!description;
  return (
    <RACTextField
      isRequired={isRequired}
      isInvalid={isInvalid}
      className={`flex flex-col gap-field-label ${className}`}
    >
      <FieldLabelRow label={label} isOptional={isOptional} />
      {children}
      {hasSupport || supportEnd ? (
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1">
            <FieldSupport
              description={description}
              isInvalid={isInvalid}
              errorMessage={errorMessage}
            />
          </span>
          {supportEnd}
        </span>
      ) : null}
    </RACTextField>
  );
}

export type InputProps = Omit<ComponentProps<typeof RACInput>, 'className'> & {
  /** 只承担外部宽度与布局 */
  className?: string;
};

/** 单行原生输入（规范 §2.1）：44px、16px 文字、无描边色面 + 状态环。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', ...rest },
  ref,
) {
  return (
    <RACInput
      ref={ref}
      className={`${CONTROL_SURFACE_CLASS} h-field ${className}`}
      {...rest}
    />
  );
});

export type TextareaProps = Omit<
  ComponentProps<typeof RACTextArea>,
  'className'
> & {
  /** 只承担外部宽度与布局 */
  className?: string;
};

/** 多行原生输入（规范 §7.4）：最小 112px，不显示浏览器拖拽角。 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className = '', ...rest }, ref) {
    return (
      <RACTextArea
        ref={ref}
        className={`${CONTROL_SURFACE_CLASS} min-h-textarea resize-none py-3 ${className}`}
        {...rest}
      />
    );
  },
);

// ---------------------------------------------------------------------------
// Select（React Aria 单选，listbox/option 语义，不复用 Menu）
// ---------------------------------------------------------------------------

export type SelectOption = { value: string; label: string };

const SELECT_TRIGGER_CLASS =
  'flex h-field w-full items-center justify-between gap-2 rounded-field bg-field-bg px-field ' +
  'text-[length:var(--field-text-size)] text-ink outline-none ' +
  'transition-[background-color,box-shadow] duration-[var(--ease)] ' +
  'hover:bg-field-bg-hover ' +
  'focus-visible:ring-field focus-visible:ring-field-focus ' +
  'group-data-[invalid]:ring-field group-data-[invalid]:ring-field-danger ' +
  'disabled:cursor-not-allowed disabled:bg-field-bg-disabled disabled:text-muted';

/** RAC Select 的触发按钮与浮层选项列表；必须位于 RAC Select 上下文内。 */
function SelectControl({
  options,
  placeholder,
}: {
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <>
      <RACButton className={SELECT_TRIGGER_CLASS}>
        <SelectValue className="min-w-0 flex-1 truncate text-left data-[placeholder]:text-field-placeholder">
          {({ isPlaceholder, defaultChildren }) =>
            isPlaceholder ? (placeholder ?? '请选择') : defaultChildren
          }
        </SelectValue>
        <span className="shrink-0 text-muted">
          <Icon icon={ChevronDown} />
        </span>
      </RACButton>
      <RACPopover className="z-floating min-w-[var(--trigger-width)] rounded-menu border border-floating-edge bg-floating-bg p-menu shadow-floating">
        <ListBox items={options} className="outline-none">
          {(option) => (
            <ListBoxItem
              id={option.value}
              textValue={option.label}
              className="flex min-h-menu-item cursor-default items-center rounded-menu-item px-menu-item text-sm text-ink outline-none data-[focused]:bg-floating-hover data-[selected]:font-medium"
            >
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </RACPopover>
    </>
  );
}

export type SelectProps = {
  /** 基础 Select 没有可见 Label，必须提供可访问名称 */
  'aria-label': string;
  value: string;
  onChange(next: string): void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** 只承担外部宽度与布局 */
  className?: string;
};

/** 单值选择控件（规范 §2.1）：React Aria 键盘模型，不替代 Menu/Segment。 */
export function Select({
  'aria-label': ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: SelectProps) {
  return (
    <RACSelect
      aria-label={ariaLabel}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
      isDisabled={disabled}
      className={className}
    >
      <SelectControl options={options} placeholder={placeholder} />
    </RACSelect>
  );
}

// ---------------------------------------------------------------------------
// 组合层
// ---------------------------------------------------------------------------

type TextLikeSharedProps = ValidationProps & {
  label: string;
  name: string;
  isRequired?: boolean;
  isOptional?: boolean;
  description?: string;
  value?: string;
  defaultValue?: string;
  onChange?(value: string): void;
  onBlur?(event: FocusEvent<HTMLInputElement>): void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 只承担 Field 外部宽度与布局 */
  className?: string;
};

export type TextFieldProps = TextLikeSharedProps & {
  /** 密码输入固定走 PasswordField */
  type?: 'text' | 'email' | 'url' | 'tel' | 'search' | 'number';
  inputMode?:
    | 'none'
    | 'text'
    | 'tel'
    | 'url'
    | 'email'
    | 'numeric'
    | 'decimal'
    | 'search';
  autoComplete?: string;
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  maxLength?: number;
  /** 搜索框与可快速撤销的短文本字段；需受控 value，不与 Password 尾动作并存 */
  isClearable?: boolean;
};

/** 尾部动作：40px 命中区（--field-end-hit）、16px 图标（--field-icon-size）。 */
const END_ACTION_CLASS =
  'absolute inset-y-0 right-0 flex w-[var(--field-end-hit)] items-center justify-center ' +
  'rounded-full text-muted outline-none transition-colors duration-[var(--ease)] ' +
  'hover:text-ink focus-visible:text-ink focus-visible:ring-field focus-visible:ring-field-focus';

/** 单行文本组合（规范 §2.2/§8）。 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      name,
      isRequired,
      isOptional,
      description,
      isInvalid,
      errorMessage,
      isClearable,
      value,
      defaultValue,
      onChange,
      onBlur,
      type = 'text',
      inputMode,
      autoComplete,
      enterKeyHint,
      readOnly,
      disabled,
      placeholder,
      maxLength,
      className,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
      ref,
      () => inputRef.current,
    );

    // Clear：只在启用（非 disabled/readOnly）且有值时出现（规范 §7.2）
    const showClear = !!isClearable && !disabled && !readOnly && !!value;

    // Character Count（规范 §7.4）：计数从受控 value 派生；非受控时跟踪
    // defaultValue 与后续输入。只在存在明确 maxLength 时显示。
    const [uncontrolledLength, setUncontrolledLength] = useState(
      () => (defaultValue ?? '').length,
    );
    const length = value !== undefined ? value.length : uncontrolledLength;

    return (
      <Field
        label={label}
        isRequired={isRequired}
        isOptional={isOptional}
        description={description}
        isInvalid={isInvalid}
        errorMessage={errorMessage}
        supportEnd={
          maxLength !== undefined ? (
            <CharacterCount value={length} max={maxLength} />
          ) : null
        }
        className={className}
      >
        <span className="relative">
          <Input
            ref={inputRef}
            name={name}
            type={type}
            inputMode={inputMode}
            autoComplete={autoComplete}
            enterKeyHint={enterKeyHint}
            readOnly={readOnly}
            disabled={disabled}
            required={isRequired}
            placeholder={placeholder}
            maxLength={maxLength}
            value={value}
            defaultValue={defaultValue}
            onBlur={onBlur}
            onChange={
              onChange || maxLength !== undefined
                ? (event) => {
                    setUncontrolledLength(event.target.value.length);
                    onChange?.(event.target.value);
                  }
                : undefined
            }
            className={showClear ? 'pe-[var(--field-end-hit)]' : ''}
          />
          {showClear ? (
            <button
              type="button"
              aria-label="清除"
              className={END_ACTION_CLASS}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange?.('');
                // 清空后焦点保留在 Input（规范 §7.2）
                inputRef.current?.focus();
              }}
            >
              <Icon icon={X} />
            </button>
          ) : null}
        </span>
      </Field>
    );
  },
);

export type TextareaFieldProps = ValidationProps & {
  label: string;
  name: string;
  isRequired?: boolean;
  isOptional?: boolean;
  description?: string;
  value?: string;
  defaultValue?: string;
  onChange?(value: string): void;
  onBlur?(event: FocusEvent<HTMLTextAreaElement>): void;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 受控调整最小行数，映射原生 rows；不接受任意像素高度（规范 §7.4） */
  minRows?: number;
  maxLength?: number;
  /** 只承担 Field 外部宽度与布局 */
  className?: string;
};

/** 多行文本组合（规范 §2.2）。 */
export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField(
    {
      label,
      name,
      isRequired,
      isOptional,
      description,
      isInvalid,
      errorMessage,
      value,
      defaultValue,
      onChange,
      onBlur,
      readOnly,
      disabled,
      placeholder,
      minRows,
      maxLength,
      className,
    },
    ref,
  ) {
    // Character Count（规范 §7.4）：同 TextField，只在明确 maxLength 时显示
    const [uncontrolledLength, setUncontrolledLength] = useState(
      () => (defaultValue ?? '').length,
    );
    const length = value !== undefined ? value.length : uncontrolledLength;

    return (
      <Field
        label={label}
        isRequired={isRequired}
        isOptional={isOptional}
        description={description}
        isInvalid={isInvalid}
        errorMessage={errorMessage}
        supportEnd={
          maxLength !== undefined ? (
            <CharacterCount value={length} max={maxLength} />
          ) : null
        }
        className={className}
      >
        <Textarea
          ref={ref}
          name={name}
          readOnly={readOnly}
          disabled={disabled}
          required={isRequired}
          placeholder={placeholder}
          rows={minRows}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          onBlur={onBlur}
          onChange={
            onChange || maxLength !== undefined
              ? (event) => {
                  setUncontrolledLength(event.target.value.length);
                  onChange?.(event.target.value);
                }
              : undefined
          }
        />
      </Field>
    );
  },
);

export type PasswordFieldProps = Omit<
  TextLikeSharedProps,
  'isClearable'
> & {
  autoComplete?: string;
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
};

/** 密码组合（规范 §7.1）：右侧眼睛 IconButton，切换不动 value/caret/focus。 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    {
      label,
      name,
      isRequired,
      isOptional,
      description,
      isInvalid,
      errorMessage,
      value,
      defaultValue,
      onChange,
      onBlur,
      autoComplete,
      enterKeyHint,
      readOnly,
      disabled,
      placeholder,
      className,
    },
    ref,
  ) {
    const [visible, setVisible] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
      ref,
      () => inputRef.current,
    );
    const caretRef = useRef<{
      start: number | null;
      end: number | null;
      hadFocus: boolean;
    } | null>(null);

    // 切换 type 后恢复光标与焦点（规范 §7.1：不清空值、不移光标、不动焦点）
    useLayoutEffect(() => {
      const pending = caretRef.current;
      caretRef.current = null;
      const el = inputRef.current;
      if (!pending || !el) return;
      if (pending.hadFocus) el.focus();
      try {
        if (pending.start !== null && pending.end !== null) {
          el.setSelectionRange(pending.start, pending.end);
        }
      } catch {
        // 某些 input 类型不支持选区，忽略
      }
    }, [visible]);

    return (
      <Field
        label={label}
        isRequired={isRequired}
        isOptional={isOptional}
        description={description}
        isInvalid={isInvalid}
        errorMessage={errorMessage}
        className={className}
      >
        <span className="relative">
          <Input
            ref={inputRef}
            name={name}
            type={visible ? 'text' : 'password'}
            autoComplete={autoComplete}
            enterKeyHint={enterKeyHint}
            readOnly={readOnly}
            disabled={disabled}
            required={isRequired}
            placeholder={placeholder}
            value={value}
            defaultValue={defaultValue}
            onBlur={onBlur}
            onChange={
              onChange ? (event) => onChange(event.target.value) : undefined
            }
            className="pe-[var(--field-end-hit)]"
          />
          <button
            type="button"
            aria-label={visible ? '隐藏密码' : '显示密码'}
            aria-pressed={visible}
            className={END_ACTION_CLASS}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              const el = inputRef.current;
              caretRef.current = {
                start: el?.selectionStart ?? null,
                end: el?.selectionEnd ?? null,
                hadFocus: !!el && document.activeElement === el,
              };
              setVisible((v) => !v);
            }}
          >
            <Icon icon={visible ? EyeOff : Eye} />
          </button>
        </span>
      </Field>
    );
  },
);

export type SelectFieldProps = ValidationProps & {
  label: string;
  name: string;
  isRequired?: boolean;
  isOptional?: boolean;
  description?: string;
  value: string;
  onChange(next: string): void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** 只承担 Field 外部宽度与布局 */
  className?: string;
};

/** 带 Label、提示与错误的单选组合（规范 §2.2）。 */
export function SelectField({
  label,
  name,
  isRequired,
  isOptional,
  description,
  isInvalid,
  errorMessage,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: SelectFieldProps) {
  return (
    <RACSelect
      name={name}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key))}
      isRequired={isRequired}
      isInvalid={isInvalid}
      isDisabled={disabled}
      className={`group flex flex-col gap-field-label ${className ?? ''}`}
    >
      <FieldLabelRow label={label} isOptional={isOptional} />
      <SelectControl options={options} placeholder={placeholder} />
      <FieldSupport
        description={description}
        isInvalid={isInvalid}
        errorMessage={errorMessage}
      />
    </RACSelect>
  );
}

// ---------------------------------------------------------------------------
// DateTimeField（迁移自 ui/HappenedAtField 的本地墙钟语义）
// ---------------------------------------------------------------------------

export type DateTimeFieldProps = {
  /** 本地墙钟字符串 YYYY-MM-DDTHH:mm，原样 round-trip */
  value: string;
  onChange(next: string): void;
  hint?: string;
};

/**
 * 日期与时间复合输入（规范 §7.5）。value/onChange 是本地墙钟
 * YYYY-MM-DDTHH:mm：解析与格式化只做字符串与日历字段运算，绝不构造
 * Date、不做 UTC/浏览器时区换算（与 HappenedAtField 语义逐义一致）。
 * 浮层唯一来源是 Task 5 的公开 Popover。
 */
export function DateTimeField({ value, onChange, hint }: DateTimeFieldProps) {
  const labelId = useId();
  const hintId = useId();
  const parsed = parseLocalDateTime(value);

  return (
    <I18nProvider locale="zh-CN">
      <div className="flex flex-col gap-field-label">
        <span id={labelId} className={LABEL_CLASS}>
          发生在
        </span>
        <Popover
          aria-label="选择日期和时间"
          trigger={
            <button
              type="button"
              aria-labelledby={labelId}
              aria-describedby={hint ? hintId : undefined}
              className={`${CONTROL_SURFACE_CLASS} flex h-field cursor-pointer items-center justify-between gap-2`}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {parsed ? (
                  displayLocalDateTime(parsed)
                ) : (
                  <span className="text-field-placeholder">选择日期和时间</span>
                )}
              </span>
              <span className="shrink-0 text-muted">
                <Icon icon={CalendarIcon} />
              </span>
            </button>
          }
        >
          <div className="flex p-3">
            <Calendar
              value={parsed}
              onChange={(date: DateValue) => {
                // 只取日历的日期字段，时间字段沿用当前墙钟值
                const next = new CalendarDateTime(
                  date.year,
                  date.month,
                  date.day,
                  parsed ? parsed.hour : 0,
                  parsed ? parsed.minute : 0,
                );
                onChange(formatLocalDateTime(next));
              }}
              firstDayOfWeek="mon"
              className="w-fit"
            >
              <header className="mb-2 flex items-center gap-1">
                <RACButton
                  slot="previous"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted outline-none hover:bg-floating-hover hover:text-ink focus-visible:ring-focus"
                >
                  <Icon icon={ChevronLeft} />
                </RACButton>
                <Heading className="flex-1 text-center text-sm font-semibold text-ink" />
                <RACButton
                  slot="next"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted outline-none hover:bg-floating-hover hover:text-ink focus-visible:ring-focus"
                >
                  <Icon icon={ChevronRight} />
                </RACButton>
              </header>
              <CalendarGrid className="border-separate border-spacing-1">
                <CalendarGridHeader>
                  {(day) => (
                    <CalendarHeaderCell className="h-8 w-9 text-center text-xs font-normal text-muted">
                      {day}
                    </CalendarHeaderCell>
                  )}
                </CalendarGridHeader>
                <CalendarGridBody>
                  {(date) => (
                    <CalendarCell
                      date={date}
                      className={({
                        isSelected,
                        isToday,
                        isOutsideMonth,
                        isDisabled,
                        isFocusVisible,
                      }) =>
                        [
                          'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-sm outline-none',
                          isOutsideMonth || isDisabled
                            ? 'text-muted opacity-40'
                            : 'text-ink',
                          isToday && !isSelected ? 'font-semibold text-action' : '',
                          isSelected
                            ? 'bg-action font-medium text-action-fg'
                            : 'hover:bg-floating-hover',
                          isFocusVisible ? 'ring-focus' : '',
                        ].join(' ')
                      }
                    />
                  )}
                </CalendarGridBody>
              </CalendarGrid>
            </Calendar>
            {parsed ? (
              <TimePanel
                value={parsed}
                onApply={(next) => onChange(formatLocalDateTime(next))}
              />
            ) : null}
          </div>
        </Popover>
        {hint ? (
          <span id={hintId} className={`${SUPPORT_CLASS} text-muted`}>
            {hint}
          </span>
        ) : null}
      </div>
    </I18nProvider>
  );
}

/** 时间列（语义逐义搬移自 HappenedAtField 的 PopoverTime，状态改由 value/onChange 承载）。 */
function TimePanel({
  value: t,
  onApply,
}: {
  value: CalendarDateTime;
  onApply(next: CalendarDateTime): void;
}) {
  const pm = t.hour >= 12;
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;

  return (
    <div className="ml-4 flex shrink-0 flex-col justify-center">
      <p className="mb-2 text-xs text-muted">时间</p>
      <div className="mb-3 flex rounded-full bg-bg p-0.5">
        <button
          type="button"
          aria-pressed={!pm}
          className={`flex-1 rounded-full px-2 py-1 text-xs ${pm ? 'text-muted' : 'bg-select text-select-fg'}`}
          onClick={() => onApply(t.set({ hour: hour12 === 12 ? 0 : hour12 }))}
        >
          上午
        </button>
        <button
          type="button"
          aria-pressed={pm}
          className={`flex-1 rounded-full px-2 py-1 text-xs ${pm ? 'bg-select text-select-fg' : 'text-muted'}`}
          onClick={() =>
            onApply(t.set({ hour: hour12 === 12 ? 12 : hour12 + 12 }))
          }
        >
          下午
        </button>
      </div>
      <div className="flex items-center justify-center gap-1">
        <TimeStep
          label="小时"
          value={hour12}
          onStep={(d) => {
            const next12 = ((((hour12 - 1 + d) % 12) + 12) % 12) + 1;
            const hour = (next12 % 12) + (pm ? 12 : 0);
            onApply(t.set({ hour }));
          }}
        />
        <span className="pb-0.5 text-lg text-muted">:</span>
        <TimeStep
          label="分钟"
          value={t.minute}
          pad
          onStep={(d) => onApply(t.cycle('minute', d))}
        />
      </div>
    </div>
  );
}

function TimeStep({
  label,
  value,
  onStep,
  pad: doPad,
}: {
  label: string;
  value: number;
  onStep(delta: number): void;
  pad?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        aria-label={`${label}加一`}
        className="flex h-6 w-9 items-center justify-center rounded-button text-muted hover:bg-floating-hover hover:text-ink"
        onClick={() => onStep(1)}
      >
        <Icon icon={ChevronUp} size={14} />
      </button>
      <span className="w-9 text-center text-sm tabular-nums text-ink">
        {doPad ? pad(value) : value}
      </span>
      <button
        type="button"
        aria-label={`${label}减一`}
        className="flex h-6 w-9 items-center justify-center rounded-button text-muted hover:bg-floating-hover hover:text-ink"
        onClick={() => onStep(-1)}
      >
        <Icon icon={ChevronDown} size={14} />
      </button>
    </div>
  );
}

// 本地墙钟解析/格式化（逐义搬移自 HappenedAtField）：只按字符串与日历字段
// 运算，绝不构造 Date、不做 UTC/浏览器时区换算。

function parseLocalDateTime(s: string): CalendarDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  try {
    return parseDateTime(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`);
  } catch {
    return null;
  }
}

function formatLocalDateTime(v: DateValue): string {
  const hour = 'hour' in v ? v.hour : 0;
  const minute = 'minute' in v ? v.minute : 0;
  return `${v.year}-${pad(v.month)}-${pad(v.day)}T${pad(hour)}:${pad(minute)}`;
}

function displayLocalDateTime(v: CalendarDateTime): string {
  return `${v.year}-${pad(v.month)}-${pad(v.day)} ${pad(v.hour)}:${pad(v.minute)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
