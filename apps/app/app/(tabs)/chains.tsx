import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChainDto } from '@moment/dto';
import { client } from '../../src/lib/api';
import { qk } from '../../src/lib/keys';
import { useAuth } from '../../src/lib/auth';
import { Loading } from '../../src/components/Loading';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

export default function ChainsScreen() {
  const { logout, user } = useAuth();
  const queryClient = useQueryClient();
  const { data, isPending, refetch, isRefetching } = useQuery({
    queryKey: qk.chains(),
    queryFn: () => client.listChains(),
  });

  if (isPending) return <Loading />;

  async function onLogout(): Promise<void> {
    await logout();
    queryClient.clear();
  }

  return (
    <View style={styles.flex}>
      <FlashList
        data={data ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        renderItem={({ item }: { item: ChainDto }) => (
          <Pressable style={styles.item} onPress={() => router.push(`/chains/${item.id}`)}>
            <View style={styles.itemMain}>
              <Text style={styles.name}>{item.name}</Text>
              {item.description ? <Text style={styles.desc} numberOfLines={1}>{item.description}</Text> : null}
            </View>
            <Text style={styles.role}>{ROLE_LABEL[item.myRole ?? 'viewer'] ?? ''}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有链，新建一条或等好友邀请</Text>
          </View>
        }
        ListHeaderComponent={
          <Link href="/chains-new" asChild>
            <Pressable style={styles.newBtn}>
              <Text style={styles.newBtnText}>＋ 新建链</Text>
            </Pressable>
          </Link>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Text style={styles.user}>{user?.nickname ?? ''}</Text>
            <Pressable onPress={() => void onLogout()}>
              <Text style={styles.logout}>退出登录</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f6f6f6' },
  list: { padding: 12 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 8 },
  itemMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  desc: { color: '#888', fontSize: 13, marginTop: 2 },
  role: { color: '#4a90d9', fontSize: 13 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#999' },
  newBtn: { backgroundColor: '#4a90d9', borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 12 },
  newBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  user: { color: '#666' },
  logout: { color: '#d33' },
});
