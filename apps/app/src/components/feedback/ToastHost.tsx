import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onAuthCleared } from '../../lib/token-store';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { Button } from '../Button';
import { bindToastHost } from './toast';
import {
  emptyToastState,
  reduceToastClear,
  reduceToastPromote,
  reduceToastShow,
  toastDuration,
  type ToastItem,
  type ToastQueueState,
} from './toast-queue';

/**
 * 根布局挂载的 Toast 浮层。队列在 toast-queue 纯函数里；本组件只负责计时、
 * 进出透明度和安全区。登出经 onAuthCleared 同步清空（web §5.4）。
 */
export function ToastHost() {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ToastQueueState>(emptyToastState);
  const opacity = useRef(new Animated.Value(0)).current;
  const visible = state.visible;

  useEffect(() => {
    return bindToastHost({
      show(item: ToastItem) {
        setState((s) => reduceToastShow(s, item));
      },
      clear() {
        setState(reduceToastClear());
      },
    });
  }, []);

  useEffect(() => onAuthCleared(() => setState(reduceToastClear())), []);

  useEffect(() => {
    if (!visible) {
      opacity.setValue(0);
      return;
    }
    let cancelled = false;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: t.easeMs,
      useNativeDriver: true,
    }).start();
    const id = setTimeout(() => {
      if (cancelled) return;
      Animated.timing(opacity, {
        toValue: 0,
        duration: t.easeInMs,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || cancelled) return;
        setState(reduceToastPromote);
      });
    }, toastDuration(visible));
    return () => {
      cancelled = true;
      clearTimeout(id);
      opacity.stopAnimation();
    };
  }, [visible, opacity, t.easeMs, t.easeInMs]);

  function dismiss(): void {
    setState(reduceToastPromote);
  }

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="summary"
        style={[
          styles.toast,
          { bottom: insets.bottom + t.space4, opacity },
        ]}
      >
        <Pressable style={styles.body} onPress={dismiss}>
          <Text style={styles.message}>{visible.message}</Text>
        </Pressable>
        {visible.action ? (
          <Button
            variant="quiet"
            onPress={() => {
              void visible.action?.onPress();
              dismiss();
            }}
          >
            {visible.action.label}
          </Button>
        ) : null}
      </Animated.View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    layer: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 65,
    },
    toast: {
      position: 'absolute',
      left: t.space4,
      right: t.space4,
      minHeight: t.controlHProminent + t.space1,
      borderRadius: t.radiusLg,
      backgroundColor: t.surface,
      paddingHorizontal: t.space3,
      paddingVertical: t.space3,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      shadowColor: t.toastShadowColor,
      shadowOpacity: t.scheme === 'dark' ? 0.42 : 0.18,
      shadowRadius: t.space5,
      shadowOffset: { width: 0, height: t.space4 },
      elevation: t.space2,
    },
    body: { flex: 1, minWidth: 0 },
    message: { fontSize: t.fontLabel, color: t.ink },
  });
