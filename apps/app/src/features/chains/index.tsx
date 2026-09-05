import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import type { ChainDto, ChainMemberPreview } from '@moment/dto';
import { ChainListService } from '../../services/chain-list.service';
import { ChainMark } from '../../components/ChainMark';
import { Loading } from '../../components/Loading';
import { Icon } from '../../components/Icon';
import { TabHeader } from '../../components/TabHeader';
import { UserAvatar } from '../../components/UserAvatar';
import { EmptyState } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

const ROLE_LABEL: Record<string, string> = { owner: '主理人', editor: '编辑', viewer: '只读' };

function MemberStack({ members }: { members: ChainMemberPreview[] }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const shown = members.slice(0, 3);
  if (shown.length === 0) return null;
  const size = t.space6;
  return (
    <View style={styles.stack}>
      {shown.map((m, i) => (
        <View
          key={m.userId}
          style={[
            styles.stackItem,
            {
              marginLeft: i === 0 ? 0 : -t.space2,
              zIndex: shown.length - i,
              borderColor: t.surface,
            },
          ]}
        >
          <UserAvatar url={m.avatarUrl} name={m.nickname} size={size} />
        </View>
      ))}
    </View>
  );
}

export const ChainsPage = observer(function ChainsPage() {
  const chainList = useService(ChainListService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const empty = chainList.chains.length === 0;
  const loading = chainList.$model.load.loading;

  return (
    <View style={styles.flex}>
      <TabHeader>
        <View style={styles.headerGrow} />
        <Link href="/chains-new" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="开一条新的链"
            style={styles.headerBtn}
          >
            <Icon name="plus" size={t.fontInput} color={t.ink} />
          </Pressable>
        </Link>
      </TabHeader>
      {empty && loading ? (
        <Loading />
      ) : (
        <FlashList
          data={chainList.chains}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              tintColor={t.action}
              refreshing={loading}
              onRefresh={() => void chainList.load().catch(() => undefined)}
            />
          }
          renderItem={({ item }: { item: ChainDto }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.name}
              style={styles.item}
              onPress={() => router.push(`/chains/${item.id}`)}
            >
              <ChainMark chain={item} size={t.space8} />
              <View style={styles.itemMain}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {ROLE_LABEL[item.myRole ?? 'viewer'] ?? ''}
                  {item.memberCount > 0 ? ` · ${item.memberCount} 人` : ''}
                </Text>
              </View>
              <MemberStack members={item.membersPreview} />
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              variant="plain"
              scope="page"
              title="还没有时光链"
              description="点右上角开一条，或等家人发来邀请。"
            />
          }
        />
      )}
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    headerGrow: { flex: 1 },
    headerBtn: { width: t.touchMin, height: t.touchMin, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space4 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space3,
      backgroundColor: t.surface,
      borderRadius: t.radiusMd,
      padding: t.space3,
      marginBottom: t.space2,
    },
    itemMain: { flex: 1, minWidth: 0, gap: t.space1 },
    name: { fontSize: t.fontBody, fontWeight: '600', color: t.ink },
    meta: { color: t.muted, fontSize: t.fontCaption },
    stack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
    stackItem: {
      borderWidth: 2,
      borderRadius: t.space6,
      overflow: 'hidden',
    },
  });
