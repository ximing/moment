import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MomentResponse, TemplateManifest } from '@moment/dto';
import { formatMomentTimeShort } from '../lib/format';
import { resolveMomentSummary } from '../lib/template';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';
import { AppIcon } from './AppIcon';
import { Icon } from './Icon';
import { AudioBar } from './AudioBar';
import { MediaGrid } from './MediaGrid';
import { UserAvatar } from './UserAvatar';

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
  const reactionCount = moment.reactions.reduce((sum, r) => sum + r.count, 0);
  const timeBits = [
    formatMomentTimeShort(moment.happenedAt, moment.happenedTzOffset),
    moment.isBackfill ? '补发' : null,
    ageLabel ?? null,
  ].filter(Boolean);
  const summary = templateManifest ? resolveMomentSummary(templateManifest, moment) : null;
  const geoName = (moment.payload?.geo as { place_name?: string } | undefined)?.place_name;
  const mood = moment.kind === 'standard' && typeof moment.payload?.mood === 'string' ? moment.payload.mood : null;

  return (
    <Pressable style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.head}>
        <UserAvatar url={moment.author.avatarUrl} name={moment.author.nickname} size={t.space8} />
        <Text style={styles.author} numberOfLines={1}>
          {moment.author.nickname}
        </Text>
        {mood ? (
          <View accessibilityLabel="心情" style={styles.mood}>
            <AppIcon value={mood} size={t.space5} />
          </View>
        ) : null}
        <Text style={styles.time} numberOfLines={1}>
          {timeBits.join(' · ')}
        </Text>
      </View>
      {audioMedia ? <AudioBar media={audioMedia} /> : null}
      {isVoice && moment.transcriptionStatus === 'pending' ? (
        <Text style={styles.transcribing}>转写中…</Text>
      ) : null}
      {moment.content.length > 0 ? <Text style={styles.content}>{moment.content}</Text> : null}
      <MediaGrid media={gridMedia} />
      {summary ? (
        <View style={styles.tplIconRow}>
          {summary.icon ? <AppIcon value={summary.icon} size={t.fontSupport} /> : null}
          <Text style={styles.tplLine}>{summary.text}</Text>
        </View>
      ) : null}
      {geoName ? (
        <View style={styles.tplIconRow}>
          <Icon name="map-pin" size={t.fontSupport} />
          <Text style={styles.tplLine}>{geoName}</Text>
        </View>
      ) : null}
      <View style={styles.footer}>
        {moment.persons.map((p) => {
          const label = (
            <Text style={styles.metaText}>
              {p.name}
              {p.source === 'ai' ? ' · AI' : ''}
            </Text>
          );
          return onPersonFilter ? (
            <MetaHit
              key={p.id}
              accessibilityLabel={`筛选 ${p.name}`}
              onPress={() => onPersonFilter({ id: p.id, name: p.name })}
            >
              {label}
            </MetaHit>
          ) : (
            <View key={p.id}>{label}</View>
          );
        })}
        {moment.place?.name ? (
          onPlaceFilter ? (
            <MetaHit
              accessibilityLabel={`筛选地点 ${moment.place.name}`}
              onPress={() => onPlaceFilter(moment.place!.name!)}
            >
              <Icon name="map-pin" size={t.fontCaption} />
              <Text style={styles.metaText}>{moment.place.name}</Text>
            </MetaHit>
          ) : (
            <View style={styles.metaItem}>
              <Icon name="map-pin" size={t.fontCaption} />
              <Text style={styles.metaText}>{moment.place.name}</Text>
            </View>
          )
        ) : null}
        {moment.tags.map((tag) => (
          <Text key={tag.id} style={styles.tag}>
            #{tag.name}
          </Text>
        ))}
        <View style={styles.counts}>
          <Icon name="message-circle" size={t.fontSupport} />
          <Text style={styles.countsText}>{moment.commentCount}</Text>
          {reactionCount > 0 ? <Text style={styles.countsText}>· {reactionCount}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

function MetaHit({
  accessibilityLabel,
  onPress,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: t.space2, bottom: t.space2, left: t.space1, right: t.space1 }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.space1 }}
    >
      {children}
    </Pressable>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      padding: t.space4,
      marginBottom: t.space3,
      borderRadius: t.radiusMd,
      backgroundColor: t.surface,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    author: { flexShrink: 1, minWidth: 0, fontWeight: '600', fontSize: t.fontBody, color: t.ink },
    mood: { flexShrink: 0 },
    time: { flex: 1, flexShrink: 0, textAlign: 'right', color: t.muted, fontSize: t.fontCaption },
    transcribing: { color: t.muted, fontSize: t.fontCaption, marginTop: t.space2 },
    content: { fontSize: t.fontBody, lineHeight: 22, color: t.ink, marginTop: t.space3 },
    tplLine: { color: t.muted, fontSize: t.fontSupport },
    tplIconRow: { flexDirection: 'row', alignItems: 'center', gap: t.space1, marginTop: t.space2 },
    footer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.space2,
      marginTop: t.space3,
    },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: t.space1 },
    metaText: { fontSize: t.fontCaption, color: t.muted },
    tag: { color: t.tag, fontSize: t.fontCaption },
    counts: { flexDirection: 'row', alignItems: 'center', gap: t.space1, marginLeft: 'auto' },
    countsText: { color: t.muted, fontSize: t.fontCaption },
  });
