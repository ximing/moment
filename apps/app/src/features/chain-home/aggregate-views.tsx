import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { AggregateResponse, MomentResponse } from '@moment/dto';
import { METRIC_LABELS, groupMomentsByTrips, type Trip } from '../../lib/template';
import { formatMomentTime, formatMomentTimeShort } from '../../lib/format';
import { AppIcon } from '../../components/AppIcon';
import { Icon } from '../../components/Icon';
import { Banner, EmptyState } from '../../components/feedback';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// 聚合视图词表渲染器（spec §5）：curve / milestone-axis / moodline / timeline(trips)。
// curve 用 react-native-svg 手绘（不引图表库）；map 在 ./map-view.tsx（Task 6）注入。
// 聚合投影不携带 happenedTzOffset（P3 投影形状），时间展示用查看者本地偏移——
// 家庭成员同时区的目标场景下无差（继承 P4 决策 7）。
const viewerTz = new Date().getTimezoneOffset();

/** 成长曲线：按 metric 拆线，SVG 手绘。 */
function CurveView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'curve' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const byMetric = new Map<string, { value: number; unit: string; at: string }[]>();
  for (const p of aggregate.points) {
    const list = byMetric.get(p.metric) ?? [];
    list.push({ value: p.value, unit: p.unit, at: p.happenedAt });
    byMetric.set(p.metric, list);
  }
  const metrics = [...byMetric.entries()];
  if (metrics.length === 0) {
    return (
      <EmptyState
        variant="plain"
        scope="section"
        title="还没有成长记录"
        description="记下第一次身高体重后，曲线会在这里长出来。"
      />
    );
  }
  const W = 320;
  const H = 160;
  const PAD = 24;
  return (
    <View style={styles.section}>
      {metrics.map(([metric, points]) => {
        const label = METRIC_LABELS[metric] ?? metric;
        const unit = points[0]!.unit;
        const values = points.map((p) => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(points.length - 1, 1);
        const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
        const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
        const latest = points[points.length - 1]!;
        return (
          <View key={metric} style={styles.card}>
            <Text style={styles.cardTitle}>
              {label} <Text style={styles.muted}>最近 {latest.value}{unit}</Text>
            </Text>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={`${label}曲线`}>
              <Path d={d} fill="none" stroke={t.action} strokeWidth={2} />
              {points.map((p, i) => (
                <Circle key={`${p.at}-${i}`} cx={x(i)} cy={y(p.value)} r={3} fill={t.action} />
              ))}
            </Svg>
            <View style={styles.scaleRow}>
              <Text style={styles.muted}>{min}{unit}</Text>
              <Text style={styles.muted}>{max}{unit}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 里程碑轴：左侧轨点连线，右侧标题 / 时间 / 备注，按时间正序（成长向上读）。 */
function MilestoneAxisView({
  aggregate,
  onMomentPress,
}: {
  aggregate: Extract<AggregateResponse, { view: 'milestone-axis' }>;
  onMomentPress?: (momentId: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (aggregate.items.length === 0) {
    return (
      <EmptyState
        variant="plain"
        scope="section"
        title="还没有里程碑"
        description="第一次微笑、第一次走路……都值得在这里留个位置。"
      />
    );
  }
  const last = aggregate.items.length - 1;
  return (
    <View style={styles.axis}>
      {aggregate.items.map((item, i) => (
        <Pressable
          key={item.momentId}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          onPress={() => onMomentPress?.(item.momentId)}
          style={({ pressed }) => [styles.axisItem, pressed && { opacity: t.disabledOpacity }]}
        >
          <View style={styles.axisRail}>
            <View style={styles.axisDot} />
            {i < last ? <View style={styles.axisLine} /> : null}
          </View>
          <View style={styles.axisBody}>
            <View style={styles.axisTitleRow}>
              {/* 目录 icon 是数据值（key / 存量 emoji），走 AppIcon（P3-2）；缺省仍是 · 占位 */}
              {item.icon ? <AppIcon value={item.icon} size={t.fontInput} /> : <Text style={styles.body}>·</Text>}
              <Text style={styles.axisLabel}>{item.label}</Text>
              <Icon name="chevron-right" size={t.fontSupport} color={t.muted} />
            </View>
            <Text style={styles.axisTime}>{formatMomentTimeShort(item.happenedAt, viewerTz)}</Text>
            {item.note ? <Text style={styles.axisNote}>{item.note}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** 心情线：按墙钟日的心情分布（date + emoji × count），新日在前。 */
function MoodlineView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'moodline' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (aggregate.days.length === 0) {
    return (
      <EmptyState
        variant="plain"
        scope="section"
        title="还没有心情记录"
        description="发时刻时选一抹心情，这里会画出这些日子的情绪。"
      />
    );
  }
  const days = [...aggregate.days].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <View style={styles.section}>
      {days.map((d) => (
        <View key={`${d.date}-${d.mood}`} style={styles.moodRow}>
          <Text style={styles.moodDate}>{d.date.slice(5)}</Text>
          {/* 数据值走 AppIcon（P3-2）：词表 mood emoji 渲染 svg；读屏文案保留原值（web 对称口径） */}
          <View style={styles.moodIcons} accessibilityLabel={`心情 ${d.mood}，${d.count} 次`}>
            {Array.from({ length: Math.min(d.count, 10) }, (_, i) => (
              <AppIcon key={i} value={d.mood} size={t.fontBody} />
            ))}
            {d.count > 10 ? <Text style={styles.body}> ×{d.count}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** 行程分章（timeline + groupBy:'trips'）：用已加载 moments 前端分组，不打聚合端点。
 *  已知限制（P4 H2）：只统计当前已加载的分页数据，视图内注明统计范围。 */
function TripsView({
  moments,
  chainPayload,
  hasMore,
  onMomentPress,
}: {
  moments: MomentResponse[];
  chainPayload: Record<string, unknown> | null;
  hasMore: boolean;
  onMomentPress?: (momentId: string) => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const trips = (chainPayload?.trips ?? []) as Trip[];
  if (trips.length === 0) {
    return (
      <EmptyState
        variant="plain"
        scope="section"
        title="还没有行程"
        description="在链设置里补一段行程（名称与起止日期），时刻会按行程归章。"
      />
    );
  }
  const { sections, outside } = groupMomentsByTrips(moments, trips);
  return (
    <View style={styles.section}>
      <Text style={styles.muted}>
        {hasMore ? `统计已加载的 ${moments.length} 条时刻（时间线段继续往下翻可加载更多）` : `共 ${moments.length} 条时刻`}
      </Text>
      {sections.map((s) => (
        <View key={`${s.name}-${s.start}`} style={styles.tripCard}>
          <Text style={styles.cardTitle}>
            {s.name} <Text style={styles.muted}>{s.start} ~ {s.end} · {s.moments.length} 条</Text>
          </Text>
          {s.moments.length === 0 ? (
            <Text style={styles.muted}>已加载的范围里还没有这段行程的时刻。</Text>
          ) : (
            s.moments.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={m.content.slice(0, 40) || '时刻'}
                onPress={() => onMomentPress?.(m.id)}
                style={({ pressed }) => [styles.tripMomentRow, pressed && { opacity: t.disabledOpacity }]}
              >
                <Text style={styles.tripMoment} numberOfLines={1}>
                  {formatMomentTime(m.happenedAt, m.happenedTzOffset)} · {m.content.slice(0, 40) || '（图片/视频）'}
                </Text>
                <Icon name="chevron-right" size={t.fontSupport} color={t.muted} />
              </Pressable>
            ))
          )}
        </View>
      ))}
      {outside.length > 0 ? <Text style={styles.muted}>另有 {outside.length} 条不在任何行程日期内。</Text> : null}
    </View>
  );
}

/** 视图分发（词表 switch；view='trips' 是 timeline+groupBy:'trips' 的 tab id；map 由 Task 6 注入）。
 *  三态自承（P4 H3）：loading / error（可重试）/ 空数据。 */
export function AggregateView({
  view,
  aggregate,
  moments,
  chainPayload,
  hasMore,
  isLoading,
  error,
  onRetry,
  onMomentPress,
  map,
}: {
  view: string;
  aggregate: AggregateResponse | null;
  moments: MomentResponse[];
  chainPayload: Record<string, unknown> | null;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onMomentPress?: (momentId: string) => void;
  /** map 视图组件由 Task 6 注入（避免本文件引 react-native-maps） */
  map?: (props: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) => ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (view === 'trips') {
    return (
      <TripsView
        moments={moments}
        chainPayload={chainPayload}
        hasMore={hasMore}
        onMomentPress={onMomentPress}
      />
    );
  }
  if (isLoading && !aggregate) {
    return <Text style={styles.empty}>加载中…</Text>;
  }
  if (error && !aggregate) {
    return (
      <View style={styles.section}>
        <Banner tone="error" action={{ label: '重试', onPress: onRetry }}>
          {error}
        </Banner>
      </View>
    );
  }
  if (view === 'map') {
    return <>{aggregate?.view === 'map' ? map?.({ aggregate }) : null}</>;
  }
  if (!aggregate) return null; // 防御兜底：loading/error 分支已覆盖正常路径
  if (aggregate.view === 'curve') return <CurveView aggregate={aggregate} />;
  if (aggregate.view === 'milestone-axis') {
    return <MilestoneAxisView aggregate={aggregate} onMomentPress={onMomentPress} />;
  }
  if (aggregate.view === 'moodline') return <MoodlineView aggregate={aggregate} />;
  return null;
}

const createStyles = (t: Theme) =>
  // 尺寸全部上 token 档（H1：新文件不吃旧值的迁移平移豁免）
  StyleSheet.create({
    section: { padding: t.space4, gap: t.space3 },
    empty: { color: t.muted, fontSize: t.fontSupport, textAlign: 'center', padding: t.space8 },
    card: { backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3, gap: t.space2 },
    cardTitle: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    muted: { fontSize: t.fontSupport, color: t.muted },
    body: { fontSize: t.fontBody, color: t.ink },
    scaleRow: { flexDirection: 'row', justifyContent: 'space-between' },
    axis: { paddingHorizontal: t.space4, paddingTop: t.space2, paddingBottom: t.space4 },
    axisItem: { flexDirection: 'row', alignItems: 'stretch', gap: t.space3, minHeight: t.touchMin },
    axisRail: { width: t.space8, alignItems: 'center' },
    axisDot: {
      width: t.space3,
      height: t.space3,
      borderRadius: t.space3 / 2,
      backgroundColor: t.action,
      marginTop: t.space1,
    },
    axisLine: { width: 1, flex: 1, backgroundColor: t.line, marginTop: t.space1, minHeight: t.space3 },
    axisBody: { flex: 1, minWidth: 0, paddingBottom: t.space5 },
    axisTitleRow: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    axisLabel: { flex: 1, minWidth: 0, fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    axisTime: { fontSize: t.fontCaption, color: t.muted, marginTop: t.space1 },
    axisNote: { fontSize: t.fontSupport, color: t.muted, marginTop: t.space1 },
    moodRow: { flexDirection: 'row', alignItems: 'center', gap: t.space3 },
    // 心情点平铺无间距（对齐原 join('') 视觉），尺寸档归 AppIcon size
    moodIcons: { flexDirection: 'row', alignItems: 'center' },
    // 日期列不定宽：MM-DD 等长格式自然对齐，避免一次性尺寸（评审 H1）
    moodDate: { flexShrink: 0, fontSize: t.fontSupport, color: t.muted },
    tripCard: { backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1 },
    tripMomentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      minHeight: t.touchMin,
    },
    tripMoment: { flex: 1, minWidth: 0, fontSize: t.fontSupport, color: t.muted },
  });
