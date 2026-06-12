import { useState } from 'react';
import { Button, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { registerInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { ErrorText } from '../../components/ErrorText';
import { RegisterService } from './register.service';

const RegisterContent = observer(function RegisterContent() {
  const service = useService(RegisterService);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

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
      <Button
        title={service.$model.submit.loading ? '注册中…' : '注册'}
        onPress={onSubmit}
        disabled={service.$model.submit.loading}
      />
    </Screen>
  );
});

export const RegisterPage = bindServices(RegisterContent, [RegisterService]);

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
});
