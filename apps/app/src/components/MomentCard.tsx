import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentResponse, TemplateManifest } from '@moment/dto';
import { formatMomentTime } from '../lib/format';
import { resolveMilestoneLabel, summarizePayload } from '../lib/template';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { MediaGrid } from './MediaGrid';

/** spec §4.2：onLongPress 可选（Pressable 原生支持）；权限判断在列表侧，组件不含。 */
export function MomentCard({
  moment,
  onPress,
  onLongPress,
  templateManifest,
  ageLabel,
}: {
  moment: MomentResponse;
  onPress: () => void;
  onLongPress?: () => void;
  /** 链模板 manifest（链主页传入；feed/详情不传则不显示结构化摘要——v1 已知限制，同 P4） */
  templateManifest?: TemplateManifest | null;
  /** baby 年龄标注（「1 岁 2 个月」）；调用方按链 payload.birthdate 计算 */
  ageLabel?: string;
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
          {ageLabel ? ` · ${ageLabel}` : ''}
        </Text>
      </View>
      {moment.content.length > 0 ? <Text style={styles.content}>{moment.content}</Text> : null}
      <MediaGrid media={moment.media} />
      {moment.kind !== 'standard' && templateManifest
        ? (() => {
            const p = moment.payload ?? {};
            // 与发布兜底同一函数：判重基准与兜底 content 逐字同源，不重复显示
            const summaryText = summarizePayload(templateManifest, moment.kind, p);
            if (!summaryText || moment.content.trim() === summaryText) return null;
            const { icon } = resolveMilestoneLabel(templateManifest, p); // metric 无 catalog_key → icon 恒 null
            return <Text style={styles.tplLine}>{icon ? `${icon} ${summaryText}` : summaryText}</Text>;
          })()
        : null}
      {moment.kind === 'standard' && typeof moment.payload?.mood === 'string' ? (
        <Text style={styles.tplLine} accessibilityLabel="心情">{moment.payload.mood}</Text>
      ) : null}
      {(() => {
        const geo = moment.payload?.geo as { place_name?: string } | undefined;
        return geo?.place_name ? <Text style={styles.tplLine}>📍 {geo.place_name}</Text> : null;
      })()}
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
    tplLine: { color: t.muted, fontSize: t.fontSupport, marginTop: t.space1 },
    tag: { color: t.tag, fontSize: t.fontSupport },
    counts: { color: t.muted, fontSize: t.fontSupport, marginLeft: 'auto' },
  });
