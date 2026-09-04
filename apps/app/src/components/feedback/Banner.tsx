import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../Button';

export type BannerProps = {
  tone: 'error' | 'warning' | 'info';
  action?: { label: string; onPress(): void | Promise<void> };
  children: string;
};

/**
 * 内容流中的持续反馈（web feedback §4）：柔色语义面，无边框、无阴影。
 * error 用 accessibilityRole="alert"，其余 "summary"（status 语义）。
 */
export function Banner({ tone, action, children }: BannerProps) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [pending, setPending] = useState(false);

  async function runAction(): Promise<void> {
    if (!action || pending) return;
    setPending(true);
    try {
      await action.onPress();
    } finally {
      setPending(false);
    }
  }

  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      style={[
        styles.base,
        tone === 'error' && styles.error,
        tone === 'warning' && styles.warning,
        tone === 'info' && styles.info,
      ]}
    >
      <Text style={[styles.message, tone === 'error' && styles.messageError]}>{children}</Text>
      {action ? (
        <Button variant="quiet" loading={pending} onPress={() => void runAction()}>
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space3,
      borderRadius: t.radiusMd,
      paddingHorizontal: t.space3,
      paddingVertical: t.space3,
    },
    error: { backgroundColor: t.feedbackErrorBg },
    warning: { backgroundColor: t.feedbackWarningBg },
    info: { backgroundColor: t.feedbackInfoBg },
    message: { flex: 1, minWidth: 0, fontSize: t.fontLabel, color: t.ink },
    messageError: { color: t.danger },
  });
