import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentResponse } from '@moment/dto';
import { formatMomentTime } from '../lib/format';
import { MediaGrid } from './MediaGrid';

/** spec §4.2：onLongPress 可选（Pressable 原生支持）；权限判断在列表侧，组件不含。 */
export function MomentCard({
  moment,
  onPress,
  onLongPress,
}: {
  moment: MomentResponse;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.head}>
        <Text style={styles.author}>{moment.author.nickname}</Text>
        <Text style={styles.time}>
          {formatMomentTime(moment.happenedAt, moment.happenedTzOffset)}
          {moment.isBackfill ? ' · 补发' : ''}
        </Text>
      </View>
      {moment.content.length > 0 ? <Text style={styles.content}>{moment.content}</Text> : null}
      <MediaGrid media={moment.media} />
      <View style={styles.footer}>
        {moment.tags.map((t) => (
          <Text key={t.id} style={styles.tag}>
            #{t.name}
          </Text>
        ))}
        <Text style={styles.counts}>
          💬 {moment.commentCount} · {moment.reactions.reduce((sum, r) => sum + r.count, 0)} 个表情
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee', backgroundColor: '#fff' },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  author: { fontWeight: '600', fontSize: 15 },
  time: { color: '#999', fontSize: 12 },
  content: { fontSize: 15, lineHeight: 22, color: '#222' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  tag: { color: '#4a90d9', fontSize: 13 },
  counts: { color: '#999', fontSize: 13, marginLeft: 'auto' },
});
