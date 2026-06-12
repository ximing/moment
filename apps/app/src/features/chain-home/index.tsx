import { useEffect, useState } from 'react';
import { Alert, Button, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { ChainMemberDto, MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { SegmentBar } from '../../components/SegmentBar';
import { formatRelative } from '../../lib/format';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const [segment, setSegment] = useState<ChainSegment>('timeline');

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  if (!service.chain && service.$model.loadChain.loading) return <Loading />;

  function onError(err: unknown, action: string): void {
    Alert.alert('失败', `${action}：${humanError(err)}`);
  }

  const myRole = service.myRole;
  const canManage = myRole === 'owner';

  function onRolePress(m: ChainMemberDto): void {
    if (!canManage || m.role === 'owner') return;
    Alert.alert('修改角色', `${m.nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== m.role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => void service.changeRole(m.userId, r).catch((err) => onError(err, '改角色失败')),
        })),
      {
        text: '移出链',
        style: 'destructive',
        onPress: () => void service.removeMember(m.userId).catch((err) => onError(err, '移出失败')),
      },
    ]);
  }

  async function onCreateInvite(): Promise<void> {
    try {
      const token = await service.createInvite('editor');
      await Share.share({
        message: `邀请你加入「${service.chain?.name ?? ''}」时光链：moment://invites/${token}`,
      });
    } catch (err) {
      onError(err, '生成邀请失败');
    }
  }

  function onRevokeInvite(inviteId: string): void {
    Alert.alert('吊销邀请', '吊销后对方无法再用该链接加入', [
      { text: '取消', style: 'cancel' },
      {
        text: '吊销',
        style: 'destructive',
        onPress: () => void service.revokeInvite(inviteId).catch((err) => onError(err, '吊销失败')),
      },
    ]);
  }

  return (
    <View style={styles.flex}>
      <View style={styles.head}>
        <Text style={styles.name}>{service.chain?.name ?? ''}</Text>
        {service.chain?.description ? <Text style={styles.desc}>{service.chain.description}</Text> : null}
        <Button title="＋ 发布时刻" onPress={() => router.push({ pathname: '/compose', params: { chainId: service.chainId } })} />
      </View>
      <SegmentBar<ChainSegment>
        options={[
          { value: 'timeline', label: '时间线' },
          { value: 'members', label: `成员 ${service.members.length}` },
          { value: 'invites', label: '邀请' },
          { value: 'tags', label: `标签 ${service.tags.length}` },
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'timeline' ? (
        <FlashList
          data={service.moments}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.4}
          onEndReached={() => void service.loadMore().catch(() => undefined)}
          renderItem={({ item }: { item: MomentResponse }) => (
            <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
          )}
          ListEmptyComponent={<Text style={styles.empty}>还没有时刻</Text>}
        />
      ) : null}

      {segment === 'members' ? (
        <View style={styles.section}>
          {service.members.map((m) => (
            <Pressable key={m.userId} style={styles.row} onPress={() => onRolePress(m)}>
              <Text style={styles.rowMain}>{m.nickname}</Text>
              <Text style={styles.rowSide}>{ROLE_LABEL[m.role] ?? m.role}</Text>
            </Pressable>
          ))}
          {canManage ? null : <Text style={styles.hint}>仅主理人可修改角色/移除成员</Text>}
        </View>
      ) : null}

      {segment === 'invites' ? (
        <View style={styles.section}>
          {canManage ? (
            <Button title="生成邀请（编辑）并发送" onPress={() => void onCreateInvite()} />
          ) : null}
          {service.invites.map((i) => (
            <View key={i.id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text>{ROLE_LABEL[i.role] ?? i.role}邀请 · {formatRelative(i.createdAt)}</Text>
                <Text style={styles.rowSub}>
                  {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
                </Text>
              </View>
              {i.acceptedAt || !canManage ? null : (
                <Pressable onPress={() => onRevokeInvite(i.id)}>
                  <Text style={styles.danger}>吊销</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {segment === 'tags' ? <TagsSection service={service} /> : null}
    </View>
  );
});

/** 标签段需要本地输入框 state，拆成子组件——service 经 props 传入（同一 bindServices 实例，
 *  与 web chain-settings 的 sections.tsx 同款；子块自身只 observer，不再 useService）。 */
const TagsSection = observer(function TagsSection({ service }: { service: ChainHomeService }) {
  const [name, setName] = useState('');

  function onDelete(tagId: string, tagName: string): void {
    Alert.alert('删除标签', `删除「${tagName}」将从相关时刻上移除`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () =>
          void service.deleteTag(tagId).catch((err) => Alert.alert('失败', humanError(err))),
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.tagCreate}>
        <TextInput
          style={styles.tagInput}
          value={name}
          onChangeText={setName}
          placeholder="新标签名（链内唯一，上限 100 个）"
          placeholderTextColor="#aaa"
        />
        <Button
          title="添加"
          onPress={() =>
            void service
              .addTag(name)
              .then(() => setName(''))
              .catch((err) => Alert.alert('失败', humanError(err)))
          }
        />
      </View>
      {service.tags.map((t) => (
        <View key={t.id} style={styles.row}>
          <Text style={styles.rowMain}>#{t.name}（{t.momentCount} 条）</Text>
          <Pressable onPress={() => onDelete(t.id, t.name)}>
            <Text style={styles.danger}>删除</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
});

export const ChainHomePage = bindServices(Content, [ChainHomeService]);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  head: { padding: 16, backgroundColor: '#fff', gap: 6 },
  name: { fontSize: 20, fontWeight: '700' },
  desc: { color: '#777', fontSize: 14 },
  list: { paddingBottom: 16 },
  empty: { color: '#999', textAlign: 'center', padding: 32 },
  section: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  rowMain: { flex: 1, fontSize: 15 },
  rowSide: { color: '#4a90d9', fontSize: 13 },
  rowSub: { color: '#999', fontSize: 12, marginTop: 2 },
  hint: { color: '#aaa', fontSize: 12 },
  inviteBar: { gap: 8 },
  tagCreate: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tagInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  danger: { color: '#d33', fontSize: 13 },
});
