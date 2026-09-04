import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../Button';

export type EmptyStateProps = {
  variant: 'timeline' | 'plain';
  scope: 'page' | 'section';
  title: string;
  description: string;
  action?: {
    label: string;
    onPress(): void;
    emphasis: 'primary' | 'quiet';
  };
};

/**
 * 空状态（web feedback §6）：timeline 带日子线珊瑚结；plain 只留白 + 文案。
 * 至多一个 action；空状态不是错误，不用 alert 语义。
 */
export function EmptyState({ variant, scope, title, description, action }: EmptyStateProps) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={[styles.wrap, scope === 'page' ? styles.page : styles.section]}>
      {variant === 'timeline' ? (
        <View style={styles.knot} importantForAccessibility="no-hide-descendants">
          <View style={styles.knotDot} />
          <View style={styles.knotLine} />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {action ? (
        <Button
          variant={action.emphasis === 'primary' ? 'primary' : 'quiet'}
          style={styles.action}
          onPress={action.onPress}
        >
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', paddingHorizontal: t.space6 },
    page: { paddingVertical: t.space8 + t.space4 },
    section: { paddingVertical: t.space8 },
    knot: { alignItems: 'center', marginBottom: t.space4 },
    knotDot: {
      width: t.space2,
      height: t.space2,
      borderRadius: t.space1,
      backgroundColor: t.action,
    },
    knotLine: {
      width: StyleSheet.hairlineWidth,
      height: t.space6,
      backgroundColor: t.stroke,
    },
    title: {
      fontSize: t.fontInput,
      lineHeight: t.space6,
      fontWeight: '600',
      color: t.ink,
      textAlign: 'center',
    },
    description: {
      marginTop: t.space2,
      fontSize: t.fontLabel,
      color: t.muted,
      textAlign: 'center',
    },
    action: { marginTop: t.space4, alignSelf: 'center' },
  });
