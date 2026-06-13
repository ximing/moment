import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ChainListService } from '../../services/chain-list.service';
import { Loading } from '../../components/Loading';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

export const ChainsPage = observer(function ChainsPage() {
  const chainList = useService(ChainListService);

  if (chainList.chains.length === 0 && chainList.$model.load.loading) return <Loading />;

  return (
    <View style={styles.flex}>
      <FlashList
        data={chainList.chains}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={chainList.$model.load.loading} onRefresh={() => void chainList.load().catch(() => undefined)} />
        }
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
      />
    </View>
  );
});

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
});
