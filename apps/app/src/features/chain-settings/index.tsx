import { useEffect } from 'react';
import { Alert, Button, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { CHAIN_COLORS, CHAIN_ICONS } from '@moment/dto';
import { webUrl } from '../../lib/api';
import { humanError } from '../../lib/errors';
import { AuthService } from '../../services/auth.service';
import { formatRelative } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { RequireAuth } from '../../components/RequireAuth';
import { ChainSettingsService } from './chain-settings.service';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainSettingsService);
  const auth = useService(AuthService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  if (!service.chain && service.$model.loadChain.loading) return <Loading />;
  if (!service.chain) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>链加载失败</Text>
        <Button title="重试" onPress={() => void service.loadChain().catch(() => undefined)} />
      </View>
    );
  }

  const isOwner = service.myRole === 'owner';
  // 服务端事实：createInvite 是 requireChainRole('editor')——owner/editor 都能生成；
  // 但 listInvites 仅 owner，editor 生成后看不到列表（吊销也只能 owner）。
  const canInvite = isOwner || service.myRole === 'editor';
  const myUserId = auth.user?.id;

  function onRolePress(userId: string, nickname: string, role: string): void {
    if (!isOwner || role === 'owner') return;
    Alert.alert('修改角色', `${nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => void service.changeRole(userId, r).catch((err) => onError(err, '改角色失败')),
        })),
      ...(userId === myUserId
        ? [
            {
              text: '退出链',
              style: 'destructive' as const,
              onPress: () =>
                void service
                  .leaveChain(userId)
                  .then(() => router.back())
                  .catch((err) => onError(err, '退出失败')),
            },
          ]
        : [
            {
              text: '移出链',
              style: 'destructive' as const,
              onPress: () => void service.removeMember(userId).catch((err) => onError(err, '移出失败')),
            },
          ]),
    ]);
  }

  function onTransfer(userId: string, nickname: string): void {
    Alert.alert('转让链', `把主理人转让给 ${nickname}？转让后你变为编辑`, [
      { text: '取消', style: 'cancel' },
      {
        text: '转让',
        style: 'destructive',
        onPress: () => void service.transferChain(userId).catch((err) => onError(err, '转让失败')),
      },
    ]);
  }

  function onDeleteChain(): void {
    Alert.alert('删除链', '删除后所有成员都无法访问这条链，确认？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void service
            .deleteChain()
            .then(() => router.replace('/chains'))
            .catch((err) => onError(err, '删除失败')),
      },
    ]);
  }

  /** url 是完整地址：分享链接走 `${webUrl}/share/${token}`（浏览器打开），邀请走 `moment://invites/${token}`。 */
  async function onShare(url: string): Promise<void> {
    try {
      await Share.share({ message: url });
    } catch {
      // 用户取消分享面板：静默
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: '链设置' }} />

      <Text style={styles.sectionTitle}>资料{isOwner ? '' : '（仅主理人可修改）'}</Text>
      {isOwner ? (
        <>
          <TextInput style={styles.input} value={service.formName} onChangeText={(v) => (service.formName = v)} placeholder="链名（1–100 字）" placeholderTextColor="#aaa" />
          <TextInput style={styles.input} value={service.formDescription} onChangeText={(v) => (service.formDescription = v)} placeholder="描述（可选）" placeholderTextColor="#aaa" multiline />
          <View style={styles.chipRow}>
            {CHAIN_COLORS.map((c) => (
              <Pressable key={c} style={[styles.chip, service.formColor === c && styles.chipActive]} onPress={() => (service.formColor = c)}>
                <Text style={[styles.chipText, service.formColor === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.chipRow}>
            {CHAIN_ICONS.map((i) => (
              <Pressable key={i} style={[styles.chip, service.formIcon === i && styles.chipActive]} onPress={() => (service.formIcon = i)}>
                <Text style={styles.chipText}>{i}</Text>
              </Pressable>
            ))}
          </View>
          <Button title={service.$model.saveProfile.loading ? '保存中…' : '保存资料'} disabled={service.$model.saveProfile.loading} onPress={() => void service.saveProfile().catch((err) => onError(err, '保存失败'))} />
        </>
      ) : (
        <>
          <Text style={styles.row}>{service.chain.name}</Text>
          {service.chain.description ? <Text style={styles.muted}>{service.chain.description}</Text> : null}
          {myUserId ? (
            <Button title="退出这条链" color="#d33" onPress={() => void service.leaveChain(myUserId).then(() => router.back()).catch((err) => onError(err, '退出失败'))} />
          ) : null}
        </>
      )}

      <Text style={styles.sectionTitle}>成员（{service.members.length}）</Text>
      {service.members.map((m) => (
        <Pressable key={m.userId} style={styles.rowBox} onPress={() => onRolePress(m.userId, m.nickname, m.role)}>
          <Text style={styles.row}>{m.nickname}</Text>
          <View style={styles.rowSide}>
            {isOwner && m.role !== 'owner' ? (
              <Pressable onPress={() => onTransfer(m.userId, m.nickname)}>
                <Text style={styles.link}>转让</Text>
              </Pressable>
            ) : null}
            <Text style={styles.muted}>{ROLE_LABEL[m.role] ?? m.role}</Text>
          </View>
        </Pressable>
      ))}

      {canInvite ? (
        <>
          <Text style={styles.sectionTitle}>邀请</Text>
          <Button
            title="生成邀请链接（编辑）"
            disabled={service.$model.createInvite.loading}
            onPress={() =>
              void service
                .createInvite()
                .then((token) => onShare(`邀请你加入「${service.chain?.name ?? ''}」时光链：moment://invites/${token}`))
                .catch((err) => onError(err, '生成邀请失败'))
            }
          />
        </>
      ) : null}

      {isOwner ? (
        <>
          {service.invites.map((i) => (
            <View key={i.id} style={styles.rowBox}>
              <View style={styles.rowMain}>
                <Text style={styles.row}>{ROLE_LABEL[i.role] ?? i.role}邀请 · {formatRelative(i.createdAt)}</Text>
                <Text style={styles.muted}>
                  {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
                </Text>
              </View>
              {i.acceptedAt ? null : (
                <Pressable onPress={() => void service.revokeInvite(i.id).catch((err) => onError(err, '吊销失败'))}>
                  <Text style={styles.danger}>吊销</Text>
                </Pressable>
              )}
            </View>
          ))}

          <Text style={styles.sectionTitle}>分享链接（给长辈看这条链）</Text>
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, service.shareExpire === 'never' && styles.chipActive]} onPress={() => (service.shareExpire = 'never')}>
              <Text style={[styles.chipText, service.shareExpire === 'never' && styles.chipTextActive]}>永不过期</Text>
            </Pressable>
            <Pressable style={[styles.chip, service.shareExpire === '7' && styles.chipActive]} onPress={() => (service.shareExpire = '7')}>
              <Text style={[styles.chipText, service.shareExpire === '7' && styles.chipTextActive]}>7 天</Text>
            </Pressable>
            <Pressable style={[styles.chip, service.shareExpire === '30' && styles.chipActive]} onPress={() => (service.shareExpire = '30')}>
              <Text style={[styles.chipText, service.shareExpire === '30' && styles.chipTextActive]}>30 天</Text>
            </Pressable>
          </View>
          <Button
            title={service.$model.createShareLink.loading ? '创建中…' : '创建分享链接'}
            disabled={service.$model.createShareLink.loading}
            onPress={() => void service.createShareLink().catch((err) => onError(err, '创建失败'))}
          />
          {service.shareLinks.map((s) => (
            <View key={s.id} style={styles.rowBox}>
              <View style={styles.rowMain}>
                <Text style={styles.row}>{webUrl}/share/{s.token.slice(0, 8)}…</Text>
                <Text style={styles.muted}>
                  {s.revokedAt ? '已吊销' : s.expiresAt ? `至 ${formatRelative(s.expiresAt)}` : '永不过期'} · {formatRelative(s.createdAt)}
                </Text>
              </View>
              {s.revokedAt ? null : (
                <View style={styles.rowSide}>
                  <Pressable onPress={() => void onShare(`${webUrl}/share/${s.token}`)}>
                    <Text style={styles.link}>发送</Text>
                  </Pressable>
                  <Pressable onPress={() => void service.revokeShareLink(s.id).catch((err) => onError(err, '吊销失败'))}>
                    <Text style={styles.danger}>吊销</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          <Text style={styles.sectionTitle}>危险区</Text>
          <Button title="删除这条链" color="#d33" disabled={service.$model.deleteChain.loading} onPress={onDeleteChain} />
        </>
      ) : null}
      <View />
    </ScrollView>
  );
});

const Bound = bindServices(Content, [ChainSettingsService]);

export function ChainSettingsPage() {
  return (
    <RequireAuth>
      <Bound />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  sectionTitle: { fontWeight: '600', fontSize: 15, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f2f2f2' },
  chipActive: { backgroundColor: '#4a90d9' },
  chipText: { fontSize: 13, color: '#444' },
  chipTextActive: { color: '#fff' },
  rowBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  rowMain: { flex: 1 },
  rowSide: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { fontSize: 15 },
  link: { color: '#4a90d9', fontSize: 13 },
  danger: { color: '#d33', fontSize: 13 },
  muted: { color: '#999', fontSize: 12, marginTop: 2 },
});
