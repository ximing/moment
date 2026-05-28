import { useState } from 'react';
import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { loginInputSchema } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { Screen } from '../src/components/Screen';
import { Field } from '../src/components/Field';
import { ErrorText } from '../src/components/ErrorText';
import { useAuth } from '../src/lib/auth';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('请输入有效的邮箱和密码');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      // 用 '/'（即 (tabs)/index）而非 '/(tabs)'：group 名作 href 的解析行为版本间不稳
      router.replace('/');
    } catch (err) {
      // err.message 是 UPPER_SNAKE 机器码（Phase 1 错误体），不能裸显；按 code 映射中文文案
      setError(
        err instanceof ApiError
          ? err.code === 'INVALID_CREDENTIALS'
            ? '邮箱或密码错误'
            : err.code === 'NETWORK_ERROR'
              ? '网络错误，请检查网络后重试'
              : err.message
          : '登录失败，请检查网络'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '登录' }} />
      <Text style={styles.title}>时刻</Text>
      <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Field label="密码" value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText message={error} />
      <Button title={submitting ? '登录中…' : '登录'} onPress={() => void onSubmit()} disabled={submitting} />
      <Link href="/register" asChild>
        <Pressable>
          <Text style={styles.link}>没有账号？注册</Text>
        </Pressable>
      </Link>
      <View />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginVertical: 24 },
  link: { color: '#4a90d9', textAlign: 'center', marginTop: 16 },
});
