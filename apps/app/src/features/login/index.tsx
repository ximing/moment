import { useState } from 'react';
import { Button, Pressable, StyleSheet, Text } from 'react-native';
import { Link, Stack, useRouter } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { loginInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { ErrorText } from '../../components/ErrorText';
import { LoginService } from './login.service';

const LoginContent = observer(function LoginContent() {
  const service = useService(LoginService);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null); // 仅 schema 前置校验

  function onSubmit(): void {
    const parsed = loginInputSchema.safeParse({ email: service.email, password: service.password });
    if (!parsed.success) {
      setError('请输入有效的邮箱和密码');
      return;
    }
    setError(null);
    void service
      .submit()
      // 用 '/'（即 (tabs)/index）而非 '/(tabs)'：group 名作 href 的解析行为版本间不稳
      .then(() => router.replace('/'))
      .catch(() => undefined); // API 错误横幅只读 $model.submit.error，不双写本地 state
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: '登录' }} />
      <Text style={styles.title}>时刻</Text>
      <Field label="邮箱" value={service.email} onChangeText={(v) => (service.email = v)} keyboardType="email-address" />
      <Field label="密码" value={service.password} onChangeText={(v) => (service.password = v)} secureTextEntry />
      <ErrorText message={error} />
      <ErrorText message={service.$model.submit.error ? humanError(service.$model.submit.error) : null} />
      <Button
        title={service.$model.submit.loading ? '登录中…' : '登录'}
        onPress={onSubmit}
        disabled={service.$model.submit.loading}
      />
      <Link href="/register" asChild>
        <Pressable>
          <Text style={styles.link}>没有账号？注册</Text>
        </Pressable>
      </Link>
    </Screen>
  );
});

export const LoginPage = bindServices(LoginContent, [LoginService]);

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center', marginVertical: 24 },
  link: { color: '#4a90d9', textAlign: 'center', marginTop: 16 },
});
