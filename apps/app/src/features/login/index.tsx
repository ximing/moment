import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { loginInputSchema } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { Field } from '../../components/Field';
import { ErrorText } from '../../components/ErrorText';
import { Button } from '../../components/Button';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { LoginService } from './login.service';

const LoginContent = observer(function LoginContent() {
  const service = useService(LoginService);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null); // 仅 schema 前置校验
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

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
      <Button fullWidth loading={service.$model.submit.loading} loadingText="登录中…" onPress={onSubmit}>
        登录
      </Button>
      <Button variant="quiet" style={styles.registerLink} onPress={() => router.push('/register')}>
        没有账号？注册
      </Button>
    </Screen>
  );
});

export const LoginPage = bindServices(LoginContent, [LoginService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    title: { fontSize: 28, fontWeight: '700', color: t.ink, textAlign: 'center', marginVertical: t.space6 },
    registerLink: { alignSelf: 'center', marginTop: t.space4 },
  });
