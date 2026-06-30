import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonShape = 'standard' | 'pill';

type ButtonBaseProps = {
  loading?: boolean;
  /** loading 时的进行中文案（「发布中…」）；缺省保留原 children 以稳住宽度 */
  loadingText?: string;
  disabled?: boolean;
  /** 登录/注册/接受邀请等单任务页的全宽主行动（高度升 controlHProminent） */
  fullWidth?: boolean;
  onPress?: () => void;
  children: ReactNode;
  /** 只承担宽度与外部对齐，不承担色彩/形状 */
  style?: StyleProp<ViewStyle>;
};

/** danger + pill 是非法组合（对齐 web Button spec），在类型层阻止 */
export type ButtonProps = ButtonBaseProps &
  (
    | { variant?: 'primary' | 'secondary' | 'quiet'; shape?: ButtonShape }
    | { variant: 'danger'; shape?: 'standard' }
  );

/** 各 variant 的前景色（文字 / Spinner 共用） */
function fgColor(t: Theme, variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
      return t.actionFg;
    case 'secondary':
      return t.ink;
    case 'quiet':
      return t.muted;
    case 'danger':
      return t.dangerFg;
  }
}

/**
 * 唯一按钮族（spec §4.2）：variant 表达语义层级，shape 表达场景气质。
 * 不提供 color / size / compact 等自由 props。
 * pressed 用透明度/色面反馈（不做 scale，spec §6 拍板项 6）；
 * loading 保持文案槽位、禁止重复触发；disabled 整体降透明度且禁点。
 */
export function Button({
  loading = false,
  loadingText,
  disabled = false,
  fullWidth = false,
  onPress,
  children,
  style,
  ...rest
}: ButtonProps) {
  const variant: ButtonVariant = rest.variant ?? 'primary';
  const shape: ButtonShape = rest.shape ?? 'standard';
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  const prominent = shape === 'pill' || fullWidth;
  const height = prominent ? t.controlHProminent : t.controlH;
  // 命中区不足 touchMin 时以 hitSlop 纵向补齐（spec §3.2 触控目标 44pt）
  const hitSlop = Math.max(0, (t.touchMin - height) / 2);
  // loading 只禁点不灰化（对齐 web Button spec：Loading ≠ Disabled 静态样式）；disabled 才降透明度
  const inactive = disabled || loading;

  const labelStyle: StyleProp<TextStyle> = [
    styles.label,
    variant === 'primary' && styles.labelPrimary,
    variant === 'secondary' && styles.labelSecondary,
    variant === 'quiet' && styles.labelQuiet,
    variant === 'danger' && styles.labelDanger,
  ];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={{ top: hitSlop, bottom: hitSlop }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        shape === 'pill' && styles.pill,
        fullWidth && styles.fullWidth,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && (pressed ? styles.secondaryPressed : styles.secondary),
        variant === 'quiet' && (pressed ? styles.quietPressed : styles.quiet),
        variant === 'danger' && styles.danger,
        // 实心 variant 的 pressed 反馈走透明度；色面 variant 已在上面换色面
        pressed && (variant === 'primary' || variant === 'danger') && styles.solidPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fgColor(t, variant)} /> : null}
      <Text style={labelStyle}>{loading && loadingText ? loadingText : children}</Text>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      height: t.controlH,
      borderRadius: t.buttonRadius,
      paddingHorizontal: t.buttonPx,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space2,
      alignSelf: 'flex-start',
    },
    pill: {
      height: t.controlHProminent,
      borderRadius: t.controlHProminent / 2, // 完整胶囊
      paddingHorizontal: t.buttonPillPx,
    },
    fullWidth: { height: t.controlHProminent, alignSelf: 'stretch' },
    primary: { backgroundColor: t.action },
    secondary: { backgroundColor: t.secondaryBg },
    secondaryPressed: { backgroundColor: t.pressedSoft },
    quiet: { backgroundColor: 'transparent' },
    quietPressed: { backgroundColor: t.hoverSoft },
    danger: { backgroundColor: t.danger },
    solidPressed: { opacity: 0.85 },
    disabled: { opacity: t.disabledOpacity },
    label: { fontSize: t.fontLabel, fontWeight: '600' },
    labelPrimary: { color: t.actionFg },
    labelSecondary: { color: t.ink },
    labelQuiet: { color: t.muted, fontWeight: '500' },
    labelDanger: { color: t.dangerFg },
  });
