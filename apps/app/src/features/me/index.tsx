import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/Button';
import { confirm, toast } from '../../components/feedback';
import { apkSizeLabel } from '../../lib/app-update';
import { AppUpdateService } from '../../services/app-update.service';
import { AuthService } from '../../services/auth.service';
import {
  THEME_CHOICE_OPTIONS,
  getThemeChoice,
  subscribeThemeChoice,
} from '../../theme/preference';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

export const MePage = observer(function MePage() {
  const auth = useService(AuthService);
  const update = useService(AppUpdateService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const [themeChoice, setThemeChoice] = useState(getThemeChoice);

  useEffect(() => subscribeThemeChoice(setThemeChoice), []);

  function onCheckUpdate(): void {
    if (Platform.OS !== 'android' || __DEV__) {
      toast.show(`当前 ${update.currentVersion}`);
      return;
    }
    if (update.status === 'downloading' || update.status === 'installing') {
      toast.show('正在下载新版本…');
      return;
    }
    void update
      .check({ ignoreSkip: true })
      .then((remote) => {
        if (!remote) {
          toast.show(`已是最新版本 ${update.currentVersion}`);
          return;
        }
        const size = apkSizeLabel(remote.apkBytes);
        return confirm({
          title: `有新版本 ${remote.versionName}`,
          body: size
            ? `下载（${size}）完成后会打开系统安装。现在升级？`
            : '下载完成后会打开系统安装。现在升级？',
          confirmLabel: '升级',
        }).then((ok) => (ok ? update.downloadAndInstall() : undefined));
      })
      .catch((err) => toast.error(err, '检查更新失败'));
  }

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

  const themeLabel = THEME_CHOICE_OPTIONS.find((o) => o.value === themeChoice)?.label ?? '跟随系统';

  return (
    <View style={[styles.body, { paddingTop: insets.top + t.space2 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="资料"
        onPress={() => router.push('/settings/profile')}
        style={styles.identity}
      >
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{user.nickname.slice(0, 1)}</Text>
          </View>
        )}
        <View style={styles.identityText}>
          <Text style={styles.nickname}>{user.nickname}</Text>
          <Text style={styles.muted}>{user.email}</Text>
        </View>
      </Pressable>

      <SettingsRow label="资料" onPress={() => router.push('/settings/profile')} />
      <SettingsRow label="主题" value={themeLabel} onPress={() => router.push('/settings/theme')} />
      <SettingsRow label="修改密码" onPress={() => router.push('/settings/password')} />
      <SettingsRow
        label="检查更新"
        value={
          update.status === 'downloading'
            ? '下载中…'
            : update.status === 'available' && update.remote
              ? `有 ${update.remote.versionName}`
              : update.currentVersion
        }
        onPress={onCheckUpdate}
      />

      <View style={styles.spacer} />
      <Button variant="quiet" style={styles.centerOnly} onPress={onLogout}>
        退出登录
      </Button>
    </View>
  );
});

function SettingsRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}，${value}` : label}
      onPress={onPress}
      style={styles.row}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Icon name="chevron-right" size={t.fontInput} color={t.muted} />
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    body: { flex: 1, padding: t.space4, gap: t.space2, backgroundColor: t.bg },
    identity: { flexDirection: 'row', alignItems: 'center', gap: t.space4, paddingVertical: t.space4 },
    identityText: { flex: 1, minWidth: 0, gap: t.space1 },
    avatar: { width: 80, height: 80, borderRadius: 40 },
    avatarPlaceholder: { backgroundColor: t.fieldBg, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: t.fontInput, color: t.muted, fontWeight: '600' },
    nickname: { fontWeight: '600', fontSize: t.fontInput, color: t.ink },
    muted: { color: t.muted, fontSize: t.fontLabel },
    row: {
      minHeight: t.touchMin,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      paddingVertical: t.space3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    rowLabel: { flex: 1, fontSize: t.fontBody, color: t.ink },
    rowValue: { fontSize: t.fontSupport, color: t.muted },
    centerOnly: { alignSelf: 'center' },
    spacer: { flex: 1 },
  });
