import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
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
    <View style={styles.body}>
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
      <Button loading={service.$model.changePassword.loading} loadingText="提交中…" onPress={submit}>
        确认修改
      </Button>
    </View>
  );
});

export const PasswordPage = bindServices(PasswordContent, [MeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    body: { flex: 1, padding: t.space4, gap: t.space3, backgroundColor: t.bg },
  });
