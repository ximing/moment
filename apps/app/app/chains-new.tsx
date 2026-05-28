import { useState } from 'react';
import { Alert, Button, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { createChainInputSchema } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { client } from '../src/lib/api';
import { qk } from '../src/lib/keys';
import { Screen } from '../src/components/Screen';
import { Field } from '../src/components/Field';
import { RequireAuth } from '../src/components/RequireAuth';

function ChainsNewInner() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(): Promise<void> {
    const parsed = createChainInputSchema.safeParse({ name, description: description || null, visibility: 'private' });
    if (!parsed.success) {
      Alert.alert('提示', parsed.error.issues[0]?.message ?? '名称需 1–100 字');
      return;
    }
    setSubmitting(true);
    try {
      await client.createChain(parsed.data);
      await queryClient.invalidateQueries({ queryKey: qk.chains() });
      router.back();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.hint}>链是共享时间线，创建后可邀请家人朋友共同记录。</Text>
      <Field label="名称（1–100 字）" value={name} onChangeText={setName} />
      <Field label="描述（可选）" value={description} onChangeText={setDescription} multiline />
      <Button title={submitting ? '创建中…' : '创建'} onPress={() => void onSubmit()} disabled={submitting} />
    </Screen>
  );
}

export default function ChainsNewScreen() {
  return (
    <RequireAuth>
      <ChainsNewInner />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  hint: { color: '#888', fontSize: 13 },
});
