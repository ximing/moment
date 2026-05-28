import { useState } from 'react';
import { Button, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { registerInputSchema } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { Screen } from '../src/components/Screen';
import { Field } from '../src/components/Field';
import { ErrorText } from '../src/components/ErrorText';
import { useAuth } from '../src/lib/auth';

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = registerInputSchema.safeParse({ email, password, nickname });
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
    setSubmitting(true);
    try {
      await register(parsed.data);
      router.replace('/');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'EMAIL_ALREADY_REGISTERED'
            ? '该邮箱已注册'
            : err.message
          : '注册失败，请检查网络'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '注册' }} />
      <Text style={styles.title}>注册</Text>
      <Field label="昵称" value={nickname} onChangeText={setNickname} />
      <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="密码（8–72 位）" value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText message={error} />
      <Button title={submitting ? '注册中…' : '注册'} onPress={() => void onSubmit()} disabled={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
});
