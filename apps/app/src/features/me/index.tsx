import { useEffect } from 'react';
import { Alert, Button, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import { MeService } from './me.service';

const MeContent = observer(function MeContent() {
  const auth = useService(AuthService);
  const service = useService(MeService);

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
        <Button title="清除头像" color="#d33" disabled={service.$model.clearAvatar.loading} onPress={() => void service.clearAvatar().catch((err) => onError(err, '清除失败'))} />
      ) : null}

      <Text style={styles.sectionTitle}>昵称</Text>
      <TextInputRow service={service} />

      <Text style={styles.sectionTitle}>邮箱</Text>
      <Text style={styles.muted}>{user.email}</Text>

      <View style={styles.spacer} />
      <Button title="退出登录" color="#d33" onPress={onLogout} />
    </View>
  );
});

/** 昵称输入行：TextInput 直接受控绑 service.nicknameDraft（点保存不依赖 blur 提交）。 */
const TextInputRow = observer(function TextInputRow({ service }: { service: MeService }) {
  return (
    <View style={styles.nicknameRow}>
      <TextInput
        style={styles.input}
        value={service.nicknameDraft}
        onChangeText={(v) => (service.nicknameDraft = v)}
        placeholder="昵称（1–50 字）"
        placeholderTextColor="#aaa"
        maxLength={50}
      />
      <Button
        title={service.$model.saveNickname.loading ? '保存中…' : '保存'}
        disabled={service.$model.saveNickname.loading}
        onPress={() => void service.saveNickname().catch((err) => Alert.alert('失败', err instanceof Error && !(err instanceof ApiError) ? err.message : humanError(err)))}
      />
    </View>
  );
});

export const MePage = bindServices(MeContent, [MeService]);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { flex: 1, padding: 16, gap: 10 },
  avatarBox: { alignItems: 'center', gap: 8, paddingVertical: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { backgroundColor: '#e5e5e5', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, color: '#888' },
  sectionTitle: { fontWeight: '600', fontSize: 15, marginTop: 12 },
  nicknameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  muted: { color: '#888', fontSize: 14 },
  link: { color: '#4a90d9', fontSize: 14 },
  spacer: { flex: 1 },
});
