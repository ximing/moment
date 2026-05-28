import { useMemo, useState } from 'react';
import { Alert, Button, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChainMemberDto, InviteDto, MomentResponse, TagResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { Loading } from '../../src/components/Loading';
import { MomentCard } from '../../src/components/MomentCard';
import { SegmentBar } from '../../src/components/SegmentBar';
import { RequireAuth } from '../../src/components/RequireAuth';
import { formatRelative } from '../../src/lib/format';

type Segment = 'timeline' | 'members' | 'invites' | 'tags';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

function ChainDetailInner() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('timeline');

  const chain = useQuery({ queryKey: qk.chain(chainId), queryFn: () => client.getChain(chainId) });
  const moments = useInfiniteQuery({
    queryKey: qk.chainMoments(chainId),
    queryFn: ({ pageParam }) => client.listChainMoments(chainId, { cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const members = useQuery({ queryKey: qk.members(chainId), queryFn: () => client.listMembers(chainId) });
  const invites = useQuery({ queryKey: qk.invites(chainId), queryFn: () => client.listInvites(chainId) });
  const tags = useQuery({ queryKey: qk.tags(chainId), queryFn: () => client.listTags(chainId) });

  const myRole = chain.data?.myRole;

  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: qk.members(chainId) });
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: qk.invites(chainId) });
  const invalidateTags = () => queryClient.invalidateQueries({ queryKey: qk.tags(chainId) });

  const list = useMemo(() => moments.data?.pages.flatMap((p) => p.moments) ?? [], [moments.data]);

  if (chain.isPending || members.isPending) return <Loading />;

  return (
    <View style={styles.flex}>
      <View style={styles.head}>
        <Text style={styles.name}>{chain.data?.name ?? ''}</Text>
        {chain.data?.description ? <Text style={styles.desc}>{chain.data.description}</Text> : null}
        <Button title="＋ 发布时刻" onPress={() => router.push({ pathname: '/compose', params: { chainId } })} />
      </View>
      <SegmentBar<Segment>
        options={[
          { value: 'timeline', label: '时间线' },
          { value: 'members', label: `成员 ${members.data?.length ?? 0}` },
          { value: 'invites', label: '邀请' },
          { value: 'tags', label: `标签 ${tags.data?.tags.length ?? 0}` },
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'timeline' ? (
        <FlashList
          data={list}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (moments.hasNextPage && !moments.isFetchingNextPage) void moments.fetchNextPage();
          }}
          renderItem={({ item }: { item: MomentResponse }) => (
            <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
          )}
          ListEmptyComponent={<Text style={styles.empty}>还没有时刻</Text>}
        />
      ) : null}

      {segment === 'members' ? <MembersView chainId={chainId} members={members.data ?? []} myRole={myRole} onChanged={invalidateMembers} /> : null}
      {segment === 'invites' ? <InvitesView chainId={chainId} invites={invites.data ?? []} myRole={myRole} chainName={chain.data?.name ?? ''} onChanged={invalidateInvites} /> : null}
      {segment === 'tags' ? <TagsView chainId={chainId} tags={tags.data?.tags} onChanged={invalidateTags} /> : null}
    </View>
  );
}

function MembersView({
  chainId,
  members,
  myRole,
  onChanged,
}: {
  chainId: string;
  members: ChainMemberDto[];
  myRole: string | undefined;
  onChanged: () => void;
}) {
  const canManage = myRole === 'owner';

  function onRolePress(m: ChainMemberDto): void {
    if (!canManage || m.role === 'owner') return;
    Alert.alert('修改角色', `${m.nickname} 的角色`, [
      { text: '取消', style: 'cancel' },
      ...(['editor', 'viewer'] as const)
        .filter((r) => r !== m.role)
        .map((r) => ({
          text: ROLE_LABEL[r] ?? r,
          onPress: () => {
            void clientUpdateRole(chainId, m.userId, r);
          },
        })),
      {
        text: '移出链',
        style: 'destructive',
        onPress: () => {
          void clientRemoveMember(chainId, m.userId);
        },
      },
    ]);
  }

  async function clientUpdateRole(chainId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
    try {
      await client.updateMemberRole(chainId, userId, role);
      onChanged();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    }
  }

  async function clientRemoveMember(chainId: string, userId: string): Promise<void> {
    try {
      await client.removeMember(chainId, userId);
      onChanged();
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    }
  }

  return (
    <View style={styles.section}>
      {members.map((m) => (
        <Pressable key={m.userId} style={styles.row} onPress={() => onRolePress(m)}>
          <Text style={styles.rowMain}>{m.nickname}</Text>
          <Text style={styles.rowSide}>{ROLE_LABEL[m.role] ?? m.role}</Text>
        </Pressable>
      ))}
      {canManage ? null : <Text style={styles.hint}>仅主理人可修改角色/移除成员</Text>}
    </View>
  );
}

function InvitesView({
  chainId,
  invites,
  myRole,
  chainName,
  onChanged,
}: {
  chainId: string;
  invites: InviteDto[];
  myRole: string | undefined;
  chainName: string;
  onChanged: () => void;
}) {
  const canInvite = myRole === 'owner' || myRole === 'editor';
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');

  async function onCreate(): Promise<void> {
    try {
      const invite = await client.createInvite(chainId, { role });
      onChanged();
      await Share.share({ message: `邀请你加入「${chainName}」时光链：moment://invites/${invite.token}` });
    } catch (err) {
      Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
    }
  }

  function onRevoke(inviteId: string): void {
    Alert.alert('吊销邀请', '吊销后对方无法再用该链接加入', [
      { text: '取消', style: 'cancel' },
      {
        text: '吊销',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await client.revokeInvite(inviteId);
              onChanged();
            } catch (err) {
              Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      {canInvite ? (
        <View style={styles.inviteBar}>
          <SegmentBar<'editor' | 'viewer'>
            options={[
              { value: 'editor', label: '邀请为编辑' },
              { value: 'viewer', label: '邀请为只读' },
            ]}
            value={role}
            onChange={setRole}
          />
          <Button title="生成邀请并发送" onPress={() => void onCreate()} />
        </View>
      ) : null}
      {invites.map((i) => (
        <View key={i.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text>{ROLE_LABEL[i.role] ?? i.role}邀请 · {formatRelative(i.createdAt)}</Text>
            <Text style={styles.rowSub}>
              {i.acceptedAt ? '已接受' : i.expiresAt < new Date().toISOString() ? '已过期' : '待接受'}
            </Text>
          </View>
          {i.acceptedAt || !canInvite ? null : (
            <Pressable onPress={() => onRevoke(i.id)}>
              <Text style={styles.danger}>吊销</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

function TagsView({
  chainId,
  tags,
  onChanged,
}: {
  chainId: string;
  tags: TagResponse[] | undefined;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');

  async function onCreate(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await client.createTag(chainId, trimmed);
      setName('');
      onChanged();
    } catch (err) {
      Alert.alert(
        '失败',
        err instanceof ApiError
          ? err.code === 'TAG_EXISTS'
            ? '标签已存在'
            : err.code === 'TAG_LIMIT_REACHED'
              ? '标签已达上限 100 个'
              : err.message
          : '网络错误',
      );
    }
  }

  function onDelete(tagId: string, tagName: string): void {
    Alert.alert('删除标签', `删除「${tagName}」将从相关时刻上移除`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await client.deleteTag(tagId);
              onChanged();
            } catch (err) {
              Alert.alert('失败', err instanceof ApiError ? err.message : '网络错误');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.section}>
      <View style={styles.tagCreate}>
        <TextInput style={styles.tagInput} value={name} onChangeText={setName} placeholder="新标签名（链内唯一，上限 100 个）" placeholderTextColor="#aaa" />
        <Button title="添加" onPress={() => void onCreate()} />
      </View>
      {(tags ?? []).map((t) => (
        <View key={t.id} style={styles.row}>
          <Text style={styles.rowMain}>#{t.name}（{t.momentCount} 条）</Text>
          <Pressable onPress={() => onDelete(t.id, t.name)}>
            <Text style={styles.danger}>删除</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export default function ChainDetailScreen() {
  return (
    <RequireAuth>
      <ChainDetailInner />
    </RequireAuth>
  );
}

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
