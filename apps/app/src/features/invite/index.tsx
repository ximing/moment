import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { ErrorText } from '../../components/ErrorText';
import { Button } from '../../components/Button';
import { RequireAuth } from '../../components/RequireAuth';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { InviteService } from './invite.service';

const Content = observer(function Content() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const service = useService(InviteService);
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(token);
  }, [service, token]);

  function onAccept(): void {
    setError(null);
    void service
      .submit()
      .catch((err) => setError(err instanceof ApiError ? humanError(err) : '网络错误，请重试'));
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>加入时光链</Text>
      {service.result ? (
        <>
          <Text style={styles.ok}>
            {service.result.alreadyMember ? '你已经是这条链的成员' : '已成功加入！'}（角色：
            {service.result.role === 'owner' ? '主理人' : service.result.role === 'editor' ? '编辑' : '只读'}）
          </Text>
          <Button fullWidth onPress={() => router.replace(`/chains/${service.result?.chainId}`)}>
            打开这条链
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.hint}>接受邀请后将出现在「我的链」中，即可查看与记录。</Text>
          <ErrorText message={error} />
          <Button
            fullWidth
            loading={service.$model.submit.loading}
            loadingText="加入中…"
            disabled={service.terminal}
            onPress={onAccept}
          >
            接受邀请
          </Button>
        </>
      )}
    </Screen>
  );
});

const Bound = bindServices(Content, [InviteService]);

export function InvitePage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    title: { fontSize: 24, fontWeight: '700', color: t.ink, textAlign: 'center', marginVertical: t.space4 },
    hint: { color: t.muted, fontSize: t.fontLabel },
    ok: { color: t.tag, fontSize: t.fontInput, textAlign: 'center' },
  });
