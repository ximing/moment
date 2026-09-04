import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../Button';
import { bindConfirmHost, type ConfirmRequest } from './confirm';

type OpenRequest = ConfirmRequest & { busy?: boolean };

/**
 * 居中确认面板（对齐 web AlertDialog）：无右上角关闭、点遮罩不关；
 * Android 返回键 = 取消。busy 时禁关与重复提交。
 */
export function AlertDialogHost() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [req, setReq] = useState<OpenRequest | null>(null);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    return bindConfirmHost({
      open(next) {
        return new Promise<boolean>((resolve) => {
          pending.current?.(false);
          pending.current = resolve;
          setReq(next);
        });
      },
    });
  }, []);

  function finish(ok: boolean): void {
    if (req?.busy) return;
    pending.current?.(ok);
    pending.current = null;
    setReq(null);
  }

  const cancelLabel = req?.cancelLabel === undefined ? '取消' : req.cancelLabel;

  return (
    <Modal
      visible={req != null}
      transparent
      animationType="fade"
      onRequestClose={() => finish(false)}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <View accessibilityLabel="确认面板" style={styles.panel}>
          <Text style={styles.title}>{req?.title}</Text>
          {req?.body ? <Text style={styles.body}>{req.body}</Text> : null}
          <View style={styles.actions}>
            {cancelLabel ? (
              <Button variant="quiet" disabled={Boolean(req?.busy)} onPress={() => finish(false)}>
                {cancelLabel}
              </Button>
            ) : null}
            <Button
              variant={req?.danger ? 'danger' : 'primary'}
              loading={Boolean(req?.busy)}
              onPress={() => finish(true)}
            >
              {req?.confirmLabel ?? ''}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: t.scrim,
      justifyContent: 'center',
      paddingHorizontal: t.space6,
    },
    panel: {
      backgroundColor: t.surface,
      borderRadius: t.radiusLg,
      padding: t.space6,
    },
    title: { fontSize: t.fontInput, fontWeight: '600', color: t.ink },
    body: { marginTop: t.space2, fontSize: t.fontLabel, color: t.muted },
    actions: {
      marginTop: t.space6,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: t.space2,
    },
  });
