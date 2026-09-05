import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer, useService } from '@rabjs/react';
import { Banner, confirm, toast } from '../../components/feedback';
import { apkSizeLabel } from '../../lib/app-update';
import { AppUpdateService } from '../../services/app-update.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

/** 启动后检查 GitHub latest；确认后后台下载并调起安装。 */
export const AppUpdateHost = observer(function AppUpdateHost() {
  const service = useService(AppUpdateService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const prompted = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => {
      void service.check().catch(() => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [service]);

  useEffect(() => {
    if (service.status !== 'available' || prompted.current || !service.remote) return;
    prompted.current = true;
    const remote = service.remote;
    const size = apkSizeLabel(remote.apkBytes);
    void confirm({
      title: `有新版本 ${remote.versionName}`,
      body: size
        ? `下载（${size}）完成后会打开系统安装。现在升级？`
        : '下载完成后会打开系统安装。现在升级？',
      confirmLabel: '升级',
    })
      .then((ok) => (ok ? service.downloadAndInstall() : service.skip()))
      .catch((err) => toast.error(err, '更新失败'));
  }, [service, service.status, service.remote]);

  if (service.status !== 'downloading' && service.status !== 'installing') return null;
  const label =
    service.status === 'installing'
      ? '正在打开安装…'
      : `正在后台下载 ${service.remote?.versionName ?? '新版本'}…`;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + t.space6 }]}>
      <Banner tone="info">{label}</Banner>
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: t.space3,
      right: t.space3,
    },
  });
