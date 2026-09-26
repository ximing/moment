import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { observer, useService } from '@rabjs/react';
import { Banner, confirm, toast } from '../../components/feedback';
import { apkSizeLabel } from '../../lib/app-update';
import { AppUpdateService } from '../../services/app-update.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

/** 启动后检查 GitHub latest。有新版先后台下载，下完再问要不要安装。 */
export const AppUpdateHost = observer(function AppUpdateHost() {
  const service = useService(AppUpdateService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const prompting = useRef(false);
  const toastedError = useRef<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      void service.check().catch(() => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [service]);

  useEffect(() => {
    if (!service.installPrompt || service.status !== 'ready' || !service.remote || prompting.current) return;
    prompting.current = true;
    service.installPrompt = false;
    const remote = service.remote;
    const size = apkSizeLabel(remote.apkBytes);
    void confirm({
      title: `新版本 ${remote.versionName} 已下载`,
      body: size ? `安装包已准备好（${size}）。现在安装？` : '安装包已准备好。现在安装？',
      confirmLabel: '安装',
      cancelLabel: '稍后',
    })
      .then((ok) => (ok ? service.install() : undefined))
      .catch((err) => toast.error(err, '更新失败'))
      .finally(() => {
        prompting.current = false;
      });
  }, [service, service.installPrompt, service.status, service.remote]);

  useEffect(() => {
    if (service.status !== 'error' || !service.error || toastedError.current === service.error) return;
    toastedError.current = service.error;
    toast.error(service.error, '更新失败');
  }, [service.status, service.error]);

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
