import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/**
 * 对齐 web Field spec：无底框描边，fieldBg 色面；focus 时 2px focus 描边
 * （边框常驻 transparent 占位，focus 不改变尺寸与位置）；危险态 danger 描边。
 */
export function Field({
  label,
  isInvalid = false,
  onFocus,
  onBlur,
  ...inputProps
}: TextInputProps & { label?: string; isInvalid?: boolean }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [focused, setFocused] = useState(false);
  return (
    <>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, focused && styles.inputFocused, isInvalid && styles.inputInvalid]}
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...inputProps}
      />
    </>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    label: { fontSize: t.fontLabel, color: t.muted },
    input: {
      height: t.fieldH,
      borderWidth: 2,
      borderColor: 'transparent',
      borderRadius: t.fieldRadius,
      paddingHorizontal: t.space3,
      fontSize: t.fontInput,
      color: t.ink,
      backgroundColor: t.fieldBg,
    },
    inputFocused: { borderColor: t.focus },
    inputInvalid: { borderColor: t.danger },
  });
