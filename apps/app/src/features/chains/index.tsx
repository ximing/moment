import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto } from '@moment/dto';
import { ChainListService } from '../../services/chain-list.service';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/Button';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

export const ChainsPage = observer(function ChainsPage() {
  const chainList = useService(ChainListService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

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
            <Button style={styles.newBtn}>＋ 新建链</Button>
          </Link>
        }
      />
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    list: { padding: t.space3 },
    item: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 8, padding: 14, marginBottom: t.space2 },
    itemMain: { flex: 1 },
    name: { fontSize: t.fontInput, fontWeight: '600', color: t.ink },
    desc: { color: t.muted, fontSize: t.fontSupport, marginTop: 2 },
    role: { color: t.tag, fontSize: t.fontSupport },
    empty: { padding: t.space8, alignItems: 'center' },
    emptyText: { color: t.muted },
    newBtn: { alignSelf: 'stretch', marginBottom: t.space3 },
  });
