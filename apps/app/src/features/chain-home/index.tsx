import { useEffect, useState } from 'react';
import { Alert, Button, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { humanError } from '../../lib/errors';
import { Loading } from '../../components/Loading';
import { MomentCard } from '../../components/MomentCard';
import { SegmentBar } from '../../components/SegmentBar';
import { ChainHomeService, type ChainSegment } from './chain-home.service';

const Content = observer(function Content() {
  const { chainId } = useLocalSearchParams<{ chainId: string }>();
  const service = useService(ChainHomeService);
  const [segment, setSegment] = useState<ChainSegment>('timeline');

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
            <Button title="＋ 发布时刻" onPress={() => router.push({ pathname: '/compose', params: { chainId: service.chainId } })} />
          ) : null}
          <Pressable style={styles.gear} onPress={() => router.push(`/chains/${service.chainId}/settings`)}>
            <Text style={styles.gearText}>⚙️ 设置</Text>
          </Pressable>
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
            <MomentCard moment={item} onPress={() => router.push(`/moments/${item.id}`)} />
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
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gear: { paddingVertical: 6 },
  gearText: { color: '#4a90d9', fontSize: 14 },
  list: { paddingBottom: 16 },
  empty: { color: '#999', textAlign: 'center', padding: 32 },
  section: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 8, padding: 14 },
  rowMain: { flex: 1, fontSize: 15 },
  tagCreate: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tagInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  danger: { color: '#d33', fontSize: 13 },
});
