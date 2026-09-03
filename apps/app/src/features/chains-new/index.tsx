import { useEffect, useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { createChainInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { AppIcon } from '../../components/AppIcon';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { RequireAuth } from '../../components/RequireAuth';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ChainsNewService } from './chains-new.service';

const Content = observer(function Content() {
  const service = useService(ChainsNewService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

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
      Alert.alert('提示', parsed.error.issues[0]?.message ?? '名称需 1–100 字');
      return;
    }
    void service
      .submit()
      .then(() => router.back())
      .catch((err) => Alert.alert('失败', humanError(err)));
  }

  return (
    <Screen scroll>
      <Text style={styles.hint}>链是共享时间线，创建后可邀请家人朋友共同记录。</Text>
      {service.templates.length > 0 ? (
        <View style={styles.tplSection}>
          <Text style={styles.tplLabel}>这条链记什么</Text>
          <Text style={styles.tplHint}>模板选定后不可更改</Text>
          {service.templates.map((tpl) => (
            <Pressable
              key={tpl.key}
              accessibilityRole="button"
              accessibilityState={{ selected: service.template === tpl.key }}
              style={[styles.tplCard, service.template === tpl.key && styles.tplCardActive]}
              onPress={() => (service.template = tpl.key)}
            >
              {/* icon 走 AppIcon：tpl-* 词表 key 渲染 svg，自由 emoji 原文兜底；
                  size 与 tplName 字号（fontBody）对齐，维持原视觉 */}
              <View style={styles.tplNameRow}>
                <AppIcon value={tpl.icon} size={t.fontBody} />
                <Text style={styles.tplName}>{tpl.name}</Text>
              </View>
              {tpl.description ? <Text style={styles.tplDesc}>{tpl.description}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <Field label="名称（1–100 字）" value={service.name} onChangeText={(v) => (service.name = v)} />
      <Field label="描述（可选）" value={service.description} onChangeText={(v) => (service.description = v)} multiline />
      <Button fullWidth loading={service.$model.submit.loading} loadingText="创建中…" onPress={onSubmit}>
        创建
      </Button>
    </Screen>
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
    hint: { color: t.muted, fontSize: t.fontSupport },
    tplSection: { gap: t.space2, marginBottom: t.space3 },
    tplLabel: { fontSize: t.fontLabel, color: t.ink, fontWeight: '600' },
    tplHint: { fontSize: t.fontCaption, color: t.muted },
    tplCard: { backgroundColor: t.surface, borderRadius: t.radiusMd, borderWidth: 2, borderColor: t.line, padding: t.space3, gap: t.space1, minHeight: t.touchMin },
    tplCardActive: { borderColor: t.action },
    tplNameRow: { flexDirection: 'row', alignItems: 'center', gap: t.space1 },
    tplName: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    tplDesc: { fontSize: t.fontSupport, color: t.muted },
  });
