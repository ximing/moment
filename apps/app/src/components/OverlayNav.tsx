import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { Icon, type AppLineIconName } from './Icon';

/** 顶栏占位：状态栏 + 胶囊行（视觉高度 space8，命中区用 hitSlop 补到 touchMin）。 */
export function overlayNavInset(insetsTop: number, t: Theme): number {
  return insetsTop + t.space2 + t.space8 + t.space2;
}

export type CapsuleTone = 'page' | 'media';

function CapsuleShell({
  children,
  style,
  tone = 'page',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: CapsuleTone;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={[styles.shell, tone === 'media' ? styles.shellMedia : styles.shellPage, style]}>
      {children}
    </View>
  );
}

export function CapsuleIconButton({
  name,
  label,
  onPress,
  disabled,
  tone = 'page',
}: {
  name: AppLineIconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: CapsuleTone;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const iconColor = tone === 'media' ? t.actionFg : t.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: t.space2, bottom: t.space2, left: t.space2, right: t.space2 }}
      style={({ pressed }) => [
        (pressed || disabled) && { opacity: t.disabledOpacity },
        pressed && { transform: [{ scale: t.pressedScale }] },
      ]}
    >
      <CapsuleShell style={styles.iconShell} tone={tone}>
        <Icon name={name} size={t.fontLabel} color={iconColor} />
      </CapsuleShell>
    </Pressable>
  );
}

export function CapsuleCluster({
  items,
  tone = 'page',
}: {
  items: { name: AppLineIconName; label: string; onPress: () => void }[];
  tone?: CapsuleTone;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const iconColor = tone === 'media' ? t.actionFg : t.ink;
  const width = items.length * t.space8 + Math.max(0, items.length - 1) + 2;
  return (
    <CapsuleShell style={[styles.cluster, { width }]} tone={tone}>
      {items.map((item, i) => (
        <View key={item.label} style={styles.clusterItem}>
          {i > 0 ? <View style={tone === 'media' ? styles.clusterSplitMedia : styles.clusterSplit} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={item.onPress}
            hitSlop={{ top: t.space2, bottom: t.space2 }}
            style={({ pressed }) => [
              styles.clusterBtn,
              pressed && { opacity: t.disabledOpacity, transform: [{ scale: t.pressedScale }] },
            ]}
          >
            <Icon name={item.name} size={t.fontLabel} color={iconColor} />
          </Pressable>
        </View>
      ))}
    </CapsuleShell>
  );
}

export function CapsuleTextButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={{ top: t.space2, bottom: t.space2 }}
      style={({ pressed }) => [
        (pressed || disabled) && { opacity: t.disabledOpacity },
        pressed && { transform: [{ scale: t.pressedScale }] },
      ]}
    >
      <CapsuleShell style={styles.textShell} tone="page">
        {loading ? (
          <ActivityIndicator size="small" color={t.action} />
        ) : (
          <Text style={styles.textAction}>{label}</Text>
        )}
      </CapsuleShell>
    </Pressable>
  );
}

/** 顶栏：返回单独一颗胶囊；右侧可以是搜索+更多合体，或文字胶囊。 */
export function OverlayNav({
  title,
  leading,
  showTitle = true,
  absolute = false,
  bar = true,
  onBack,
  right,
}: {
  title?: string;
  leading?: ReactNode;
  showTitle?: boolean;
  /** 叠在封面之上（链首页） */
  absolute?: boolean;
  /** 铺底，避免内容顶进状态栏；封面未收起时关掉 */
  bar?: boolean;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const visibleTitle = Boolean(showTitle && title);
  const tone: CapsuleTone = absolute && !bar ? 'media' : 'page';

  return (
    <View pointerEvents="box-none" style={[absolute ? styles.absolute : styles.flow, bar && styles.barBg]}>
      {absolute && !bar ? (
        <View pointerEvents="none" style={[styles.statusScrim, { height: insets.top }]} />
      ) : null}
      <View pointerEvents="box-none" style={[styles.row, { paddingTop: insets.top + t.space2 }]}>
        <CapsuleIconButton name="chevron-left" label="返回" tone={tone} onPress={onBack ?? (() => router.back())} />
        <View
          pointerEvents="none"
          style={styles.titleWrap}
          accessibilityElementsHidden={!visibleTitle}
        >
          {visibleTitle ? leading : null}
          {title ? (
            <Text numberOfLines={1} style={[styles.title, { opacity: visibleTitle ? 1 : 0 }]}>
              {title}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>{right ?? <View style={styles.iconShell} />}</View>
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    absolute: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: t.space5,
      elevation: t.space5,
    },
    flow: { zIndex: t.space1 },
    barBg: { backgroundColor: t.bg },
    statusScrim: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: t.scrim,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: t.space3,
      paddingBottom: t.space2,
      gap: t.space2,
    },
    shell: {
      overflow: 'hidden',
      borderRadius: t.space8 / 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shellPage: {
      backgroundColor: t.overlayCapsule,
      borderWidth: 1,
      borderColor: t.overlayCapsuleBorder,
    },
    shellMedia: {
      backgroundColor: t.overlayCapsuleOnMedia,
      borderWidth: 1,
      borderColor: t.overlayCapsuleOnMediaBorder,
    },
    iconShell: {
      width: t.space8,
      height: t.space8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    trailing: { flexShrink: 0 },
    cluster: {
      flexDirection: 'row',
      alignItems: 'center',
      height: t.space8,
      flexShrink: 0,
    },
    clusterItem: { flexDirection: 'row', alignItems: 'center' },
    clusterBtn: {
      width: t.space8,
      height: t.space8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clusterSplit: {
      width: 1,
      height: t.space3,
      backgroundColor: t.ink,
      opacity: t.disabledOpacity,
    },
    clusterSplitMedia: {
      width: 1,
      height: t.space3,
      backgroundColor: t.actionFg,
      opacity: t.disabledOpacity,
    },
    textShell: {
      minHeight: t.space8,
      paddingHorizontal: t.space3,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textAction: { fontSize: t.fontLabel, fontWeight: '600', color: t.action },
    titleWrap: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space2,
    },
    title: {
      flexShrink: 1,
      minWidth: 0,
      fontSize: t.fontBody,
      fontWeight: '600',
      color: t.ink,
    },
  });
