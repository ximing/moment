import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import { humanError } from '../../lib/errors';
import { Screen } from '../../components/Screen';
import { RequireAuth } from '../../components/RequireAuth';
import { InviteService } from './invite.service';

const Content = observer(function Content() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const service = useService(InviteService);
  const [error, setError] = useState<string | null>(null);

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
          <Button title="打开这条链" onPress={() => router.replace(`/chains/${service.result?.chainId}`)} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>接受邀请后将出现在「我的链」中，即可查看与记录。</Text>
          <Text style={styles.error}>{error}</Text>
          {service.$model.submit.loading ? (
            <ActivityIndicator />
          ) : (
            <Button title="接受邀请" onPress={onAccept} disabled={service.terminal} />
          )}
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

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
  hint: { color: '#777', fontSize: 14 },
  ok: { color: '#2a8a4a', fontSize: 16, textAlign: 'center' },
  error: { color: '#d33', fontSize: 14 },
});
