import { type ReactNode, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 从下往上的动作表（对齐时刻详情更多）。 */
export function ActionSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, t.space4) }]}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
          <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function ActionSheetItem({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.item}>
      <Text style={styles.itemText}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radiusLg,
      borderTopRightRadius: t.radiusLg,
      paddingTop: t.space3,
      paddingHorizontal: t.space3,
    },
    handle: {
      alignSelf: 'center',
      width: t.space8,
      height: t.space1,
      borderRadius: t.space1,
      backgroundColor: t.line,
      marginBottom: t.space3,
    },
    title: {
      fontSize: t.fontBody,
      fontWeight: '600',
      color: t.ink,
      textAlign: 'center',
      marginBottom: t.space3,
    },
    item: {
      minHeight: t.touchMin,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
      marginBottom: t.space2,
    },
    itemText: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    cancel: {
      minHeight: t.touchMin,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: t.space1,
    },
    cancelText: { fontSize: t.fontBody, color: t.muted },
  });
