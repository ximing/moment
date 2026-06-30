import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { registerInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { ErrorText } from '../../components/ErrorText';
import { Button } from '../../components/Button';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { RegisterService } from './register.service';

const RegisterContent = observer(function RegisterContent() {
  const service = useService(RegisterService);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  function onSubmit(): void {
    const parsed = registerInputSchema.safeParse({
      email: service.email,
      password: service.password,
      nickname: service.nickname,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === 'password'
          ? '密码需 8–72 位'
          : issue?.path[0] === 'nickname'
            ? '昵称需 1–50 字'
            : '请输入有效邮箱'
      );
      return;
    }
    setError(null);
    void service.submit().then(() => router.replace('/')).catch(() => undefined);
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '注册' }} />
      <Text style={styles.title}>注册</Text>
      <Field label="昵称" value={service.nickname} onChangeText={(v) => (service.nickname = v)} />
      <Field label="邮箱" value={service.email} onChangeText={(v) => (service.email = v)} keyboardType="email-address" />
      <Field label="密码（8–72 位）" value={service.password} onChangeText={(v) => (service.password = v)} secureTextEntry />
      <ErrorText message={error} />
      <ErrorText message={service.$model.submit.error ? humanError(service.$model.submit.error) : null} />
      <Button fullWidth loading={service.$model.submit.loading} loadingText="注册中…" onPress={onSubmit}>
        注册
      </Button>
    </Screen>
  );
});

export const RegisterPage = bindServices(RegisterContent, [RegisterService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    title: { fontSize: 24, fontWeight: '700', color: t.ink, textAlign: 'center', marginVertical: t.space4 },
  });
