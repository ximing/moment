import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentResponse } from '@moment/dto';
import { formatMomentTime } from '../lib/format';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
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
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
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
        {moment.tags.map((tag) => (
          <Text key={tag.id} style={styles.tag}>
            #{tag.name}
          </Text>
        ))}
        <Text style={styles.counts}>
          💬 {moment.commentCount} · {moment.reactions.reduce((sum, r) => sum + r.count, 0)} 个表情
        </Text>
      </View>
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: { padding: t.space4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, backgroundColor: t.surface },
    head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    author: { fontWeight: '600', fontSize: t.fontBody, color: t.ink },
    time: { color: t.muted, fontSize: t.fontCaption },
    content: { fontSize: t.fontBody, lineHeight: 22, color: t.ink },
    footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2, marginTop: t.space2 },
    tag: { color: t.tag, fontSize: t.fontSupport },
    counts: { color: t.muted, fontSize: t.fontSupport, marginLeft: 'auto' },
  });
