import { useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Banner, confirm, toast } from '../../components/feedback';
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

  function onLogout(): void {
    void confirm({
      title: '退出登录',
      body: '退出后需要重新登录',
      confirmLabel: '退出',
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      void auth.logout().catch(() => undefined);
    });
  }

  const user = auth.user;
  if (!user) return <View style={styles.flex} />;

  const avatarError = service.$model.pickAndUploadAvatar.error ?? service.$model.clearAvatar.error;

  return (
    <View style={styles.body}>
      <View style={styles.identity}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="换头像"
          onPress={() =>
            void service
              .pickAndUploadAvatar()
              .then((p) => {
                if (p) toast.show({ key: 'avatar', message: p });
              })
              .catch((err) => toast.error(err, '上传头像失败'))
          }
        >
          {user.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>{user.nickname.slice(0, 1)}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.identityText}>
          <Text style={styles.nickname}>{user.nickname}</Text>
          <Text style={styles.muted}>{user.email}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>头像</Text>
        <Text style={styles.hint}>点头像或按钮上传一张图。和时刻里的照片一样，存在私有桶里。</Text>
        {avatarError ? (
          <Banner tone="error">{humanError(avatarError)}</Banner>
        ) : null}
        <View style={styles.row}>
          <Button
            loading={service.$model.pickAndUploadAvatar.loading}
            loadingText="上传中…"
            onPress={() =>
              void service
                .pickAndUploadAvatar()
                .then((p) => {
                  if (p) toast.show({ key: 'avatar', message: p });
                })
                .catch((err) => toast.error(err, '上传头像失败'))
            }
          >
            上传头像
          </Button>
          {user.avatarUrl ? (
            <Button
              variant="quiet"
              loading={service.$model.clearAvatar.loading}
              loadingText="清除中…"
              onPress={() => void service.clearAvatar().catch((err) => toast.error(err, '清除失败'))}
            >
              去掉头像
            </Button>
          ) : null}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>主题</Text>
        <ThemeToggle />
      </View>

      <View style={styles.section}>
        <TextInputRow service={service} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>修改密码</Text>
        <ChangePasswordForm service={service} onSuccess={() => void auth.logout().catch(() => undefined)} />
      </View>

      <View style={styles.spacer} />
      <Button variant="quiet" style={styles.centerOnly} onPress={onLogout}>
        退出登录
      </Button>
    </View>
  );
});

/** 修改密码：成功后服务端已全端下线——先确认，再 logout 收敛本地态（踢回 /login）。 */
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
      .then(async () => {
        await confirm({
          title: '密码已修改',
          body: '所有设备已退出登录，请用新密码重新登录',
          confirmLabel: '好',
          cancelLabel: null,
        });
        onSuccess();
      })
      .catch((err) => toast.error(err, '修改失败'));
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

/** 昵称输入行：Field 受控绑 service.nicknameDraft（点保存不依赖 blur 提交）。 */
const TextInputRow = observer(function TextInputRow({ service }: { service: MeService }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <View style={styles.nicknameRow}>
      <View style={styles.nicknameField}>
        <Field
          label="昵称"
          value={service.nicknameDraft}
          onChangeText={(v) => (service.nicknameDraft = v)}
          placeholder="昵称（1–50 字）"
          maxLength={50}
        />
      </View>
      <Button
        loading={service.$model.saveNickname.loading}
        loadingText="保存中…"
        onPress={() => void service.saveNickname().catch((err) => toast.error(err, '失败'))}
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
    body: { flex: 1, padding: t.space4, gap: t.space3, backgroundColor: t.bg },
    identity: { flexDirection: 'row', alignItems: 'center', gap: t.space4, paddingVertical: t.space4 },
    identityText: { flex: 1, minWidth: 0, gap: t.space1 },
    avatar: { width: 80, height: 80, borderRadius: 40 },
    avatarPlaceholder: { backgroundColor: t.fieldBg, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: t.fontInput, color: t.muted, fontWeight: '600' },
    nickname: { fontWeight: '600', fontSize: t.fontInput, color: t.ink },
    section: { gap: t.space2 },
    sectionTitle: { fontWeight: '600', fontSize: t.fontLabel, color: t.muted },
    hint: { fontSize: t.fontSupport, color: t.muted },
    nicknameRow: { flexDirection: 'row', gap: t.space2, alignItems: 'flex-end' },
    nicknameField: { flex: 1, minWidth: 0 },
    muted: { color: t.muted, fontSize: t.fontLabel },
    passwordForm: { gap: t.space2 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, alignItems: 'center' },
    centerOnly: { alignSelf: 'center' },
    spacer: { flex: 1 },
  });
