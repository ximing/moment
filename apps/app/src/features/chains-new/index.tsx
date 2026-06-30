import { useMemo } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { createChainInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
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

  function onSubmit(): void {
    const parsed = createChainInputSchema.safeParse({
      name: service.name,
      description: service.description || null,
      visibility: 'private',
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
  });
