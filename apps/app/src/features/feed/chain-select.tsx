import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChainAppearanceColor } from '@moment/dto';
import { ChainMark } from '../../components/ChainMark';
import { Icon } from '../../components/Icon';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

type ChainOption = {
  id: string;
  name: string;
  color: ChainAppearanceColor | null;
  icon: string | null;
  avatarUrl: string | null;
};

export function ChainSelect({
  chains,
  chainId,
  order,
  onSelect,
  onToggleOrder,
}: {
  chains: ChainOption[];
  chainId: string | undefined;
  order: 'happened_at' | 'created_at';
  onSelect: (id: string | undefined) => void;
  onToggleOrder: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = chainId == null ? '全部链' : (chains.find((c) => c.id === chainId)?.name ?? '全部链');

  function pick(id: string | undefined): void {
    onSelect(id);
    setOpen(false);
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`选择链，当前 ${current}`}
        onPress={() => setOpen(true)}
        style={styles.trigger}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {current}
        </Text>
        <Icon name="chevron-down" size={t.fontLabel} color={t.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="关闭" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, t.space4) }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>选择链</Text>
            <View style={styles.orderRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (order !== 'happened_at') onToggleOrder();
                }}
                style={[styles.orderChip, order === 'happened_at' && styles.orderChipActive]}
              >
                <Text style={[styles.orderChipText, order === 'happened_at' && styles.orderChipTextActive]}>
                  发生时间
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (order !== 'created_at') onToggleOrder();
                }}
                style={[styles.orderChip, order === 'created_at' && styles.orderChipActive]}
              >
                <Text style={[styles.orderChipText, order === 'created_at' && styles.orderChipTextActive]}>
                  添加时间
                </Text>
              </Pressable>
            </View>
            <ScrollView style={styles.list}>
              <Pressable
                accessibilityRole="button"
                onPress={() => pick(undefined)}
                style={[styles.option, chainId == null && styles.optionActive]}
              >
                <View style={styles.allMark}>
                  <Icon name="link-2" size={t.fontLabel} color={t.ink} />
                </View>
                <Text style={[styles.optionText, chainId == null && styles.optionTextActive]}>全部链</Text>
                {chainId == null ? <Icon name="check" size={t.fontInput} color={t.ink} /> : null}
              </Pressable>
              {chains.map((c) => {
                const active = chainId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    onPress={() => pick(c.id)}
                    style={[styles.option, active && styles.optionActive]}
                  >
                    <ChainMark chain={c} size={t.controlH} />
                    <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {active ? <Icon name="check" size={t.fontInput} color={t.ink} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    trigger: {
      flex: 1,
      minWidth: 0,
      minHeight: t.touchMin,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space1,
    },
    triggerText: { flexShrink: 1, fontSize: t.fontInput, color: t.ink, fontWeight: '700' },
    scrim: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: t.radiusLg,
      borderTopRightRadius: t.radiusLg,
      paddingTop: t.space3,
      maxHeight: '70%',
    },
    handle: {
      alignSelf: 'center',
      width: t.space8,
      height: t.space1,
      borderRadius: t.space1,
      backgroundColor: t.line,
      marginBottom: t.space3,
    },
    sheetTitle: {
      fontSize: t.fontLabel,
      color: t.muted,
      paddingHorizontal: t.space4,
      marginBottom: t.space3,
    },
    orderRow: {
      flexDirection: 'row',
      gap: t.space2,
      paddingHorizontal: t.space4,
      marginBottom: t.space3,
    },
    orderChip: {
      flex: 1,
      minHeight: t.touchMin,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
    },
    orderChipActive: { backgroundColor: t.ink },
    orderChipText: { fontSize: t.fontSupport, color: t.ink },
    orderChipTextActive: { color: t.bg, fontWeight: '600' },
    list: { maxHeight: 360 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space3,
      minHeight: t.touchMin,
      marginHorizontal: t.space3,
      marginBottom: t.space2,
      paddingHorizontal: t.space3,
      paddingVertical: t.space3,
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
    },
    optionActive: { backgroundColor: t.secondaryBg },
    optionText: { flex: 1, minWidth: 0, fontSize: t.fontBody, color: t.ink },
    optionTextActive: { fontWeight: '600' },
    allMark: {
      width: t.controlH,
      height: t.controlH,
      borderRadius: t.controlH / 2,
      backgroundColor: t.secondaryBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
