import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentResponse, TemplateManifest } from '@moment/dto';
import { formatMomentTime } from '../lib/format';
import { resolveMomentSummary } from '../lib/template';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { AppIcon } from './AppIcon';
import { Icon } from './Icon';
import { AudioBar } from './AudioBar';
import { MediaGrid } from './MediaGrid';

/** spec §4.2：onLongPress 可选（Pressable 原生支持）；权限判断在列表侧，组件不含。 */
export function MomentCard({
  moment,
  onPress,
  onLongPress,
  templateManifest,
  ageLabel,
  onPersonFilter,
  onPlaceFilter,
}: {
  moment: MomentResponse;
  onPress: () => void;
  onLongPress?: () => void;
  /** 链模板 manifest（链主页传入；feed/详情不传则不显示结构化摘要——v1 已知限制，同 P4） */
  templateManifest?: TemplateManifest | null;
  /** baby 年龄标注（「1 岁 2 个月」）；调用方按链 payload.birthdate 计算 */
  ageLabel?: string;
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const isVoice = moment.type === 'voice';
  const audioMedia = isVoice ? moment.media.find((m) => m.mime.startsWith('audio/')) : undefined;
  // voice 附图只传 image/* 行：audio/* 是内容本体进播放条，不能进宫格（spec §6）
  const gridMedia = isVoice ? moment.media.filter((m) => m.mime.startsWith('image/')) : moment.media;
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
      {audioMedia ? <AudioBar media={audioMedia} /> : null}
      {isVoice && moment.transcriptionStatus === 'pending' ? (
        <Text style={styles.transcribing}>转写中…</Text>
      ) : null}
      {moment.content.length > 0 ? <Text style={styles.content}>{moment.content}</Text> : null}
      <MediaGrid media={gridMedia} />
      {templateManifest
        ? (() => {
            // 判重基准与兜底 content 逐字同源（resolveMomentSummary 内部完成），不重复显示
            const summary = resolveMomentSummary(templateManifest, moment);
            if (!summary) return null;
            // 数据值 icon 走 AppIcon：词表 key / 存量 emoji 渲染 svg，其余原文兜底（P3-2）
            return (
              <View style={styles.tplIconRow}>
                {summary.icon ? <AppIcon value={summary.icon} size={t.fontSupport} /> : null}
                <Text style={[styles.tplLine, styles.flushTop]}>{summary.text}</Text>
              </View>
            );
          })()
        : null}
      {moment.kind === 'standard' && typeof moment.payload?.mood === 'string' ? (
        <View style={styles.tplIconRow} accessibilityLabel="心情">
          <AppIcon value={moment.payload.mood} size={t.fontSupport} />
        </View>
      ) : null}
      {(() => {
        const geo = moment.payload?.geo as { place_name?: string } | undefined;
        return geo?.place_name ? (
          <View style={styles.tplIconRow}>
            <Icon name="map-pin" size={t.fontSupport} />
            <Text style={[styles.tplLine, styles.flushTop]}>{geo.place_name}</Text>
          </View>
        ) : null;
      })()}
      {/* 人物与地点（spec fused-retrieval §7.1）：时间线传入回调则内层 Pressable 可点过滤；
          往年今日/不传回调保持 P6 只读 View。AI 角标保留。name 为 null 的地点仍不渲染。 */}
      {moment.persons.length > 0 ? (
        <View style={styles.personRow} accessibilityLabel="和谁在一起">
          {moment.persons.map((p) => {
            const label = p.name;
            const inner = (
              <Text style={styles.personChipText}>
                {p.name}
                {p.source === 'ai' ? <Text style={styles.personAi}> AI</Text> : null}
              </Text>
            );
            return onPersonFilter ? (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`筛选 ${label}`}
                onPress={() => onPersonFilter({ id: p.id, name: p.name })}
                style={styles.personChipPressable}
              >
                {inner}
              </Pressable>
            ) : (
              <View key={p.id} style={styles.personChip}>
                {inner}
              </View>
            );
          })}
        </View>
      ) : null}
      {moment.place?.name ? (
        onPlaceFilter ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`筛选地点 ${moment.place.name}`}
            onPress={() => onPlaceFilter(moment.place!.name!)}
            style={styles.placePressable}
          >
            <View style={styles.tplIconRow}>
              <Icon name="map-pin" size={t.fontSupport} />
              <Text style={[styles.tplLine, styles.flushTop]}>{moment.place.name}</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.tplIconRow}>
            <Icon name="map-pin" size={t.fontSupport} />
            <Text style={[styles.tplLine, styles.flushTop]}>{moment.place.name}</Text>
          </View>
        )
      ) : null}
      <View style={styles.footer}>
        {moment.tags.map((tag) => (
          <Text key={tag.id} style={styles.tag}>
            #{tag.name}
          </Text>
        ))}
        <View style={styles.counts}>
          <Icon name="message-circle" size={t.fontSupport} />
          <Text style={styles.countsText}>
            {moment.commentCount} · {moment.reactions.reduce((sum, r) => sum + r.count, 0)} 个表情
          </Text>
        </View>
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
    transcribing: { color: t.muted, fontSize: t.fontCaption, marginTop: t.space1 },
    content: { fontSize: t.fontBody, lineHeight: 22, color: t.ink },
    footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2, marginTop: t.space2 },
    tplLine: { color: t.muted, fontSize: t.fontSupport, marginTop: t.space1 },
    tplIconRow: { flexDirection: 'row', alignItems: 'center', gap: t.space1, marginTop: t.space1 },
    flushTop: { marginTop: 0 },
    personRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, marginTop: t.space1 },
    personChip: { paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    personChipPressable: {
      paddingHorizontal: t.space3,
      paddingVertical: t.space1,
      borderRadius: t.radiusMd,
      backgroundColor: t.hoverSoft,
      minHeight: t.touchMin,
      justifyContent: 'center',
    },
    placePressable: {
      minHeight: t.touchMin,
      justifyContent: 'center',
    },
    personChipText: { fontSize: t.fontSupport, color: t.ink },
    personAi: { color: t.muted, fontSize: t.fontCaption },
    tag: { color: t.tag, fontSize: t.fontSupport },
    counts: { flexDirection: 'row', alignItems: 'center', gap: t.space1, marginLeft: 'auto' },
    countsText: { color: t.muted, fontSize: t.fontSupport },
  });
