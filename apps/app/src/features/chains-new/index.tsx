import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { createChainInputSchema } from '@moment/dto';
import { AppIcon } from '../../components/AppIcon';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/feedback';
import { RequireAuth } from '../../components/RequireAuth';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ChainsNewService } from './chains-new.service';

const Content = observer(function Content() {
  const service = useService(ChainsNewService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void service.loadTemplates().catch(() => undefined); // 失败静默：选择器不渲染，默认 daily
  }, []);

  function onSubmit(): void {
    const parsed = createChainInputSchema.safeParse({
      name: service.name,
      description: service.description || null,
      visibility: 'private',
      template: service.template,
    });
    if (!parsed.success) {
      toast.show({ key: 'chain-new', message: parsed.error.issues[0]?.message ?? '名称需 1–100 字' });
      return;
    }
    void service
      .submit()
      .then(() => {
        toast.show({ key: 'chain-new', message: '已开一条新的链' });
        router.back();
      })
      .catch((err) => toast.error(err));
  }

  const loading = service.$model.submit.loading;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.nav, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Icon name="chevron-left" size={t.fontInput} color={t.ink} />
          <Text style={styles.backText}>返回</Text>
        </Pressable>
        <Text style={styles.navTitle} numberOfLines={1}>
          新的链
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="创建"
          onPress={onSubmit}
          disabled={loading}
          style={[styles.actionBtn, loading && { opacity: t.disabledOpacity }]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={t.action} />
          ) : (
            <Text style={styles.actionText}>创建</Text>
          )}
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, t.space6) }]}
        keyboardShouldPersistTaps="handled"
      >
        {service.templates.length > 0 ? (
          <View style={styles.tplSection}>
            <Text style={styles.tplHint}>模板选定后不可更改</Text>
            {service.templates.map((tpl) => {
              const active = service.template === tpl.key;
              return (
                <Pressable
                  key={tpl.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.tplRow, active && styles.tplRowActive]}
                  onPress={() => (service.template = tpl.key)}
                >
                  <AppIcon value={tpl.icon} size={t.fontInput} />
                  <View style={styles.tplMain}>
                    <Text style={styles.tplName}>{tpl.name}</Text>
                    {tpl.description ? (
                      <Text style={styles.tplDesc} numberOfLines={1}>
                        {tpl.description}
                      </Text>
                    ) : null}
                  </View>
                  {active ? <Icon name="check" size={t.fontInput} color={t.ink} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Field
          label="名称"
          value={service.name}
          onChangeText={(v) => (service.name = v)}
          placeholder="比如：宝宝成长"
        />
        <Field
          label="描述（可选）"
          value={service.description}
          onChangeText={(v) => (service.description = v)}
          placeholder="一句话介绍这条链"
        />
      </ScrollView>
    </View>
  );
});

const Bound = bindServices(Content, [ChainsNewService]);

export function ChainsNewPage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.surface },
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: t.space2,
      paddingBottom: t.space1,
      backgroundColor: t.surface,
      minHeight: t.touchMin,
    },
    backBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: t.touchMin,
      paddingHorizontal: t.space1,
      gap: t.space1,
      zIndex: 1,
    },
    backText: { fontSize: t.fontBody, color: t.ink },
    navTitle: {
      position: 'absolute',
      left: t.space8 + t.space8,
      right: t.space8 + t.space8,
      textAlign: 'center',
      fontSize: t.fontBody,
      fontWeight: '600',
      color: t.ink,
    },
    actionBtn: {
      minHeight: t.touchMin,
      minWidth: t.touchMin,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.space3,
      zIndex: 1,
      marginLeft: 'auto',
    },
    actionText: { fontSize: t.fontBody, fontWeight: '600', color: t.action },
    scroll: { paddingHorizontal: t.space4, paddingTop: t.space3, gap: t.space3 },
    tplSection: { gap: t.space2 },
    tplHint: { fontSize: t.fontCaption, color: t.muted },
    tplRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space3,
      minHeight: t.touchMin,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.fieldBg,
    },
    tplRowActive: { backgroundColor: t.secondaryBg },
    tplMain: { flex: 1, minWidth: 0, gap: t.space1 },
    tplName: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    tplDesc: { fontSize: t.fontCaption, color: t.muted },
  });
