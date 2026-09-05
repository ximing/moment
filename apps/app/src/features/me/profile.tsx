import { useEffect, useMemo } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bindServices, observer, useService } from '@rabjs/react';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { UserAvatar } from '../../components/UserAvatar';
import { Banner, toast } from '../../components/feedback';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { MeService } from './me.service';

const ProfileContent = observer(function ProfileContent() {
  const auth = useService(AuthService);
  const service = useService(MeService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const avatarSize = t.space8 * 2 + t.space4;

  useEffect(() => {
    service.hydrateFromUser();
  }, [service]);

  const user = auth.user;
  if (!user) return <View style={styles.flex} />;

  const avatarError = service.$model.pickAndUploadAvatar.error ?? service.$model.clearAvatar.error;

  function onPick(): void {
    void service
      .pickAndUploadAvatar()
      .then((p) => {
        if (p) toast.show({ key: 'avatar', message: p });
      })
      .catch((err) => toast.error(err, '上传头像失败'));
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="换头像"
          style={styles.avatarBox}
          onPress={onPick}
        >
          <UserAvatar url={user.avatarUrl} name={user.nickname} size={avatarSize} />
          <Text style={styles.link}>
            {service.$model.pickAndUploadAvatar.loading ? '上传中…' : '更换头像'}
          </Text>
        </Pressable>
        <Text style={styles.hint}>点头像换一张。和时刻里的照片一样，存在私有桶里。</Text>
        {avatarError ? <Banner tone="error">{humanError(avatarError)}</Banner> : null}
        {user.avatarUrl ? (
          <Button
            variant="quiet"
            style={styles.centerBtn}
            loading={service.$model.clearAvatar.loading}
            loadingText="清除中…"
            onPress={() => void service.clearAvatar().catch((err) => toast.error(err, '清除失败'))}
          >
            去掉头像
          </Button>
        ) : null}

        <View style={styles.section}>
          <Field
            label="昵称"
            value={service.nicknameDraft}
            onChangeText={(v) => (service.nicknameDraft = v)}
            placeholder="昵称（1–50 字）"
            maxLength={50}
          />
          <Button
            fullWidth
            loading={service.$model.saveNickname.loading}
            loadingText="保存中…"
            onPress={() => void service.saveNickname().catch((err) => toast.error(err, '失败'))}
          >
            保存昵称
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
});

export const ProfilePage = bindServices(ProfileContent, [MeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    body: { padding: t.space4, gap: t.space4 },
    avatarBox: { alignItems: 'center', gap: t.space2, paddingTop: t.space2 },
    link: { color: t.action, fontSize: t.fontLabel, fontWeight: '600' },
    hint: { fontSize: t.fontSupport, color: t.muted, textAlign: 'center' },
    centerBtn: { alignSelf: 'center' },
    section: { gap: t.space3 },
  });
