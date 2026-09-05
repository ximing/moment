import { useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
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

  useEffect(() => {
    service.hydrateFromUser();
  }, [service]);

  const user = auth.user;
  if (!user) return <View style={styles.flex} />;

  const avatarError = service.$model.pickAndUploadAvatar.error ?? service.$model.clearAvatar.error;

  return (
    <View style={styles.body}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="换头像"
        style={styles.avatarBox}
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
        <Text style={styles.link}>换头像</Text>
      </Pressable>

      <Text style={styles.hint}>点头像或按钮上传一张图。和时刻里的照片一样，存在私有桶里。</Text>
      {avatarError ? <Banner tone="error">{humanError(avatarError)}</Banner> : null}
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
    </View>
  );
});

export const ProfilePage = bindServices(ProfileContent, [MeService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    body: { flex: 1, padding: t.space4, gap: t.space3, backgroundColor: t.bg },
    avatarBox: { alignItems: 'center', gap: t.space2, paddingVertical: t.space4 },
    avatar: { width: 80, height: 80, borderRadius: 40 },
    avatarPlaceholder: { backgroundColor: t.fieldBg, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: t.fontInput, color: t.muted, fontWeight: '600' },
    link: { color: t.action, fontSize: t.fontLabel },
    hint: { fontSize: t.fontSupport, color: t.muted },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, alignItems: 'center' },
    nicknameRow: { flexDirection: 'row', gap: t.space2, alignItems: 'flex-end' },
    nicknameField: { flex: 1, minWidth: 0 },
  });
