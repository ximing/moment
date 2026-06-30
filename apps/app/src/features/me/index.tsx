import { useEffect, useMemo } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { MeService } from './me.service';

const MeContent = observer(function MeContent() {
  const auth = useService(AuthService);
  const service = useService(MeService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrateFromUser();
  }, [service]);

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  function onLogout(): void {
    Alert.alert('退出登录', '退出后需要重新登录', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        // logout → secureTokenStore.clear() → auth:changed(null) → RequireAuth 踢回 /login
        onPress: () => void auth.logout().catch(() => undefined),
      },
    ]);
  }

  const user = auth.user;
  if (!user) return <View style={styles.flex} />;

  return (
    <View style={styles.body}>
      <Pressable style={styles.avatarBox} onPress={() => void service.pickAndUploadAvatar().then((p) => { if (p) Alert.alert('无法上传', p); }).catch((err) => onError(err, '上传头像失败'))}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{user.nickname.slice(0, 1)}</Text>
          </View>
        )}
        <Text style={styles.link}>换头像</Text>
      </Pressable>
      {user.avatarUrl ? (
        <Pressable style={styles.centerBtn} disabled={service.$model.clearAvatar.loading} onPress={() => void service.clearAvatar().catch((err) => onError(err, '清除失败'))}>
          <Text style={styles.danger}>清除头像</Text>
        </Pressable>
      ) : null}

      <Text style={styles.sectionTitle}>昵称</Text>
      <TextInputRow service={service} />

      <Text style={styles.sectionTitle}>邮箱</Text>
      <Text style={styles.muted}>{user.email}</Text>

      <Text style={styles.sectionTitle}>修改密码</Text>
      <ChangePasswordForm service={service} onSuccess={() => void auth.logout().catch(() => undefined)} />

      <View style={styles.spacer} />
      <Button variant="quiet" style={styles.centerBtn} onPress={onLogout}>
        退出登录
      </Button>
    </View>
  );
});

/** 修改密码：成功后服务端已全端下线——先提示，确认后 logout 收敛本地态（踢回 /login）。 */
const ChangePasswordForm = observer(function ChangePasswordForm({
  service,
  onSuccess,
}: {
  service: MeService;
  onSuccess: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  function submit(): void {
    void service
      .changePassword()
      .then(() => {
        Alert.alert('密码已修改', '所有设备已退出登录，请用新密码重新登录', [{ text: '好', onPress: onSuccess }]);
      })
      .catch((err) =>
        Alert.alert('修改失败', err instanceof Error && !(err instanceof ApiError) ? err.message : humanError(err))
      );
  }

  return (
    <View style={styles.passwordForm}>
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

/** 昵称输入行：TextInput 直接受控绑 service.nicknameDraft（点保存不依赖 blur 提交）。 */
const TextInputRow = observer(function TextInputRow({ service }: { service: MeService }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.nicknameRow}>
      <TextInput
        style={styles.input}
        value={service.nicknameDraft}
        onChangeText={(v) => (service.nicknameDraft = v)}
        placeholder="昵称（1–50 字）"
        placeholderTextColor={t.muted}
        maxLength={50}
      />
      <Button
        loading={service.$model.saveNickname.loading}
        loadingText="保存中…"
        onPress={() => void service.saveNickname().catch((err) => Alert.alert('失败', err instanceof Error && !(err instanceof ApiError) ? err.message : humanError(err)))}
      >
        保存
      </Button>
    </View>
  );
});

export const MePage = bindServices(MeContent, [MeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    body: { flex: 1, padding: t.space4, gap: 10, backgroundColor: t.bg },
    avatarBox: { alignItems: 'center', gap: t.space2, paddingVertical: t.space4 },
    avatar: { width: 80, height: 80, borderRadius: 40 },
    avatarPlaceholder: { backgroundColor: t.fieldBg, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 32, color: t.muted },
    sectionTitle: { fontWeight: '600', fontSize: t.fontBody, color: t.ink, marginTop: t.space3 },
    nicknameRow: { flexDirection: 'row', gap: t.space2, alignItems: 'center' },
    input: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: t.space3, paddingVertical: t.space2, backgroundColor: t.surface, color: t.ink },
    muted: { color: t.muted, fontSize: t.fontLabel },
    passwordForm: { gap: t.space2 },
    link: { color: t.action, fontSize: t.fontLabel },
    danger: { color: t.danger, fontSize: t.fontLabel },
    centerBtn: { alignSelf: 'center', paddingVertical: t.space1 },
    spacer: { flex: 1 },
  });
