import { useMemo } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { confirm, toast } from '../../components/feedback';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { MeService } from './me.service';

const PasswordContent = observer(function PasswordContent() {
  const auth = useService(AuthService);
  const service = useService(MeService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();

  function submit(): void {
    void service
      .changePassword()
      .then(async () => {
        await confirm({
          title: '密码已修改',
          body: '所有设备已退出登录，请用新密码重新登录',
          confirmLabel: '好',
          cancelLabel: null,
        });
        void auth.logout().catch(() => undefined);
      })
      .catch((err) => toast.error(err, '修改失败'));
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, t.space6) }]}
      >
        <Text style={styles.hint}>修改成功后，所有设备都要用新密码重新登录。</Text>
        <Field
          label="旧密码"
          secureTextEntry
          value={service.oldPasswordDraft}
          onChangeText={(v) => (service.oldPasswordDraft = v)}
          placeholder="当前密码"
        />
        <Field
          label="新密码"
          secureTextEntry
          value={service.newPasswordDraft}
          onChangeText={(v) => (service.newPasswordDraft = v)}
          placeholder="8–72 位"
        />
        <Field
          label="确认新密码"
          secureTextEntry
          value={service.confirmPasswordDraft}
          onChangeText={(v) => (service.confirmPasswordDraft = v)}
          placeholder="再输一遍新密码"
        />
        <Button
          fullWidth
          loading={service.$model.changePassword.loading}
          loadingText="提交中…"
          onPress={submit}
        >
          确认修改
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
});

export const PasswordPage = bindServices(PasswordContent, [MeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    body: { padding: t.space4, gap: t.space4 },
    hint: { fontSize: t.fontSupport, color: t.muted },
  });
