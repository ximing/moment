import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { SegmentBar } from '../../components/SegmentBar';
import { Button } from '../../components/Button';
import { AuthService } from '../../services/auth.service';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { showMomentActions } from '../compose/moment-actions';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const auth = useService(AuthService);
  const myId = auth.user?.id; // 在 observer 渲染内取值，renderItem 闭包复用（禁解构 observable）
  const [segment, setSegment] = useState<ChainSegment>('timeline');
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  if (!service.chain && service.$model.loadChain.loading) return <Loading />;

  return (
    <View style={styles.flex}>
      <View style={styles.head}>
        <Text style={styles.name}>{service.chain?.name ?? ''}</Text>
        {service.chain?.description ? <Text style={styles.desc}>{service.chain.description}</Text> : null}
        <View style={styles.headActions}>
          {service.canCompose ? (
            <Button onPress={() => router.push({ pathname: '/compose', params: { chainId: service.chainId } })}>＋ 发布时刻</Button>
          ) : null}
          <Button variant="quiet" onPress={() => router.push(`/chains/${service.chainId}/settings`)}>⚙️ 设置</Button>
        </View>
      </View>
      <SegmentBar<ChainSegment>
        options={[
          { value: 'timeline', label: '时间线' },
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
            <MomentCard
              moment={item}
              onPress={() => router.push(`/moments/${item.id}`)}
              onLongPress={
                // spec §4.2：长按编辑/删除仅作者本人的卡片生效
                myId === item.author.id
                  ? () =>
                      showMomentActions(item, () =>
                        router.push({ pathname: '/compose', params: { momentId: item.id } }),
                      )
                  : undefined
              }
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>还没有时刻</Text>}
        />
      ) : null}

      {segment === 'tags' ? <TagsSection service={service} /> : null}
    </View>
  );
});

/** 标签段需要本地输入框 state，拆成子组件——service 经 props 传入（同一 bindServices 实例，
 *  与 web chain-settings 的 sections.tsx 同款；子块自身只 observer，不再 useService）。 */
const TagsSection = observer(function TagsSection({ service }: { service: ChainHomeService }) {
  const [name, setName] = useState('');
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

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
          placeholderTextColor={t.muted}
        />
        <Button
          variant="secondary"
          onPress={() =>
            void service
              .addTag(name)
              .then(() => setName(''))
              .catch((err) => Alert.alert('失败', humanError(err)))
          }
        >
          添加
        </Button>
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

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    head: { padding: t.space4, backgroundColor: t.surface, gap: 6 },
    name: { fontSize: 20, fontWeight: '700', color: t.ink },
    desc: { color: t.muted, fontSize: t.fontLabel },
    headActions: { flexDirection: 'row', alignItems: 'center', gap: t.space3 },
    list: { paddingBottom: t.space4 },
    empty: { color: t.muted, textAlign: 'center', padding: t.space8 },
    section: { padding: t.space4, gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 8, padding: 14 },
    rowMain: { flex: 1, fontSize: t.fontBody, color: t.ink },
    tagCreate: { flexDirection: 'row', gap: t.space2, alignItems: 'center' },
    tagInput: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: t.space3, paddingVertical: t.space2, backgroundColor: t.surface, color: t.ink },
    danger: { color: t.danger, fontSize: t.fontSupport },
  });
