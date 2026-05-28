import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { AcceptInviteResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../src/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../../src/lib/keys';
import { Screen } from '../../src/components/Screen';
import { RequireAuth } from '../../src/components/RequireAuth';

const TERMINAL_INVITE_CODES = new Set(['INVITE_EXPIRED', 'INVITE_ALREADY_ACCEPTED', 'INVITE_EMAIL_MISMATCH']);

function InviteInner() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AcceptInviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);

  async function onAccept(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setTerminal(false);
    try {
      const res = await client.acceptInvite(token);
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: qk.chains() });
    } catch (err) {
      if (err instanceof ApiError) {
        const message =
          err.code === 'INVITE_NOT_FOUND'
            ? '邀请不存在或已被吊销'
            : err.code === 'INVITE_EXPIRED'
              ? '邀请已过期'
              : err.code === 'INVITE_ALREADY_ACCEPTED'
                ? '邀请已被使用'
                : err.code === 'INVITE_EMAIL_MISMATCH'
                  ? '该邀请限定了其他邮箱'
                  : err.message;
        setError(message);
        setTerminal(TERMINAL_INVITE_CODES.has(err.code));
      } else {
        setError('网络错误，请重试');
        setTerminal(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>加入时光链</Text>
      {result ? (
        <>
          <Text style={styles.ok}>
            {result.alreadyMember ? '你已经是这条链的成员' : '已成功加入！'}（角色：
            {result.role === 'owner' ? '主理人' : result.role === 'editor' ? '编辑' : '只读'}）
          </Text>
          <Button title="打开这条链" onPress={() => router.replace(`/chains/${result.chainId}`)} />
        </>
      ) : (
        <>
          <Text style={styles.hint}>接受邀请后将出现在「我的链」中，即可查看与记录。</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {submitting ? (
            <ActivityIndicator />
          ) : (
            <Button title="接受邀请" onPress={() => void onAccept()} disabled={terminal} />
          )}
        </>
      )}
    </Screen>
  );
}

export default function InviteScreen() {
  return (
    <RequireAuth>
      <InviteInner />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginVertical: 16 },
  hint: { color: '#777', fontSize: 14 },
  ok: { color: '#2a8a4a', fontSize: 16, textAlign: 'center' },
  error: { color: '#d33', fontSize: 14 },
});
