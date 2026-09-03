import type { ReactNode } from 'react';
import type { AggregateResponse, PublicShareMoment } from '@moment/dto';
import { METRIC_LABELS, groupMomentsByTrips, type Trip } from '@/lib/template';
import { formatHappenedClock } from '@/lib/time';
import { AppIcon } from '@/ui/AppIcon';
import { Banner, EmptyState } from '@/ui/feedback/index';

// 聚合视图词表渲染器（spec §5）：curve / milestone-axis / moodline / timeline(trips)。
// 只消费 tokens；curve 用 SVG 手绘（不引图表库）；map 在 chain/map-view.tsx（Task 6）。

/** 成长曲线：按 metric 拆线，SVG 手绘。 */
function CurveView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'curve' }> }) {
  const byMetric = new Map<string, { value: number; unit: string; at: string }[]>();
  for (const p of aggregate.points) {
    const list = byMetric.get(p.metric) ?? [];
    list.push({ value: p.value, unit: p.unit, at: p.happenedAt });
    byMetric.set(p.metric, list);
  }
  const metrics = [...byMetric.entries()];
  if (metrics.length === 0) {
    return <EmptyState variant="plain" scope="section" title="还没有成长记录" description="记下第一次身高体重后，曲线会在这里长出来。" />;
  }
  const W = 640;
  const H = 160;
  const PAD = 24;
  return (
    <div className="flex flex-col gap-6">
      {metrics.map(([metric, points]) => {
        const label = METRIC_LABELS[metric] ?? metric;
        const unit = points[0]!.unit;
        const values = points.map((p) => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(points.length - 1, 1);
        const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
        const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
        const latest = points[points.length - 1]!;
        return (
          <figure key={metric} className="rounded-surface-md bg-surface px-4 py-3">
            <figcaption className="mb-2 flex items-baseline gap-2 text-meta">
              <span className="font-semibold text-ink">{label}</span>
              <span className="text-muted">
                最近 {latest.value}
                {unit}
              </span>
            </figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}曲线`}>
              <path d={path} fill="none" stroke="var(--action)" strokeWidth={2} />
              {points.map((p, i) => (
                <circle key={`${p.at}-${i}`} cx={x(i)} cy={y(p.value)} r={3} fill="var(--action)" />
              ))}
            </svg>
            <div className="mt-1 flex justify-between text-caption text-muted">
              <span>{min}{unit}</span>
              <span>{max}{unit}</span>
            </div>
          </figure>
        );
      })}
    </div>
  );
}

/** 里程碑轴：目录 icon + label + 发生时刻 + note，按时间正序（成长向上读）。 */
function MilestoneAxisView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'milestone-axis' }> }) {
  if (aggregate.items.length === 0) {
    return <EmptyState variant="plain" scope="section" title="还没有里程碑" description="第一次微笑、第一次走路……都值得在这里留个位置。" />;
  }
  // 聚合投影不携带 happenedTzOffset（P3 投影形状），用查看者本地偏移展示——家庭成员同时区的目标场景下无差
  const viewerTz = new Date().getTimezoneOffset();
  return (
    <ol className="flex flex-col gap-3">
      {aggregate.items.map((item) => (
        <li key={item.momentId} className="flex items-baseline gap-3">
          {/* 目录 icon 是数据值，走 AppIcon（spec §4.2）；size 与 text-body(16px) 视觉等效 */}
          <span aria-hidden className="inline-flex items-center text-body">
            {item.icon ? <AppIcon value={item.icon} size={16} /> : '·'}
          </span>
          <span className="font-semibold text-ink">{item.label}</span>
          <span className="text-meta text-muted">{formatHappenedClock(item.happenedAt, viewerTz)}</span>
          {item.note && <span className="text-meta text-muted">{item.note}</span>}
        </li>
      ))}
    </ol>
  );
}

/** 心情线：按墙钟日的心情分布（date + emoji × count），新日在前。 */
function MoodlineView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'moodline' }> }) {
  if (aggregate.days.length === 0) {
    return <EmptyState variant="plain" scope="section" title="还没有心情记录" description="发时刻时选一抹心情，这里会画出这些日子的情绪。" />;
  }
  const days = [...aggregate.days].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <ol className="flex flex-col gap-2">
      {days.map((d) => (
        <li key={`${d.date}-${d.mood}`} className="flex items-center gap-3 text-body">
          <span className="w-24 shrink-0 text-meta text-muted">{d.date.slice(5)}</span>
          <span aria-label={`心情 ${d.mood}，${d.count} 次`} className="inline-flex items-center gap-0.5">
            {/* mood 是数据值（daily 模板 5 项词表），走 AppIcon（spec §4.2）；size 与 text-body(16px) 视觉等效 */}
            {Array.from({ length: Math.min(d.count, 10) }, (_, i) => (
              <AppIcon key={i} value={d.mood} size={16} />
            ))}
            {d.count > 10 && <span className="text-meta text-muted"> ×{d.count}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** 行程分章（timeline + groupBy:'trips'）：用已加载 moments 前端分组，不打聚合端点。
 *  已知限制（评审 H2）：只统计当前已加载的分页数据，视图内注明统计范围。 */
function TripsView({ moments, chainPayload, hasMore }: { moments: PublicShareMoment[]; chainPayload: Record<string, unknown> | null; hasMore: boolean }) {
  const trips = (chainPayload?.trips ?? []) as Trip[];
  if (trips.length === 0) {
    return <EmptyState variant="plain" scope="section" title="还没有行程" description="在链设置里补一段行程（名称与起止日期），时刻会按行程归章。" />;
  }
  const { sections, outside } = groupMomentsByTrips(moments, trips);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-caption text-muted">
        {hasMore ? `统计已加载的 ${moments.length} 条时刻（回时间线继续往下翻可加载更多）` : `共 ${moments.length} 条时刻`}
      </p>
      {sections.map((s) => (
        <section key={`${s.name}-${s.start}`}>
          <h3 className="mb-2 text-body font-semibold text-ink">
            {s.name}
            <span className="ml-2 text-meta font-normal text-muted">
              {s.start} ~ {s.end} · {s.moments.length} 条
            </span>
          </h3>
          {s.moments.length === 0 ? (
            <p className="text-meta text-muted">已加载的范围里还没有这段行程的时刻。</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {s.moments.map((m) => (
                <li key={m.id} className="text-meta text-muted">
                  {formatHappenedClock(m.happenedAt, m.happenedTzOffset)} · {m.content.slice(0, 40) || '（图片/视频）'}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
      {outside.length > 0 && (
        <p className="text-meta text-muted">另有 {outside.length} 条不在任何行程日期内。</p>
      )}
    </div>
  );
}

/** 视图分发（词表 switch；view='trips' 是 timeline+groupBy:'trips' 的 tab id，见 Task 5 Produces；map 由 Task 6 的 MapView 接管）。
 *  加载/失败三态由本组件承担（评审 H3）：loading 出骨架行、error 出 Banner+重试、无数据落各视图 EmptyState。 */
export function AggregateView({
  view,
  aggregate,
  moments,
  chainPayload,
  hasMore,
  isLoading,
  error,
  onRetry,
  map,
}: {
  view: string;
  aggregate: AggregateResponse | null;
  moments: PublicShareMoment[];
  chainPayload: Record<string, unknown> | null;
  /** trips 分章统计范围提示用（H2）：时间线还有未加载页 */
  hasMore: boolean;
  /** 聚合端点加载中（trips 视图不打端点，调用方传 false） */
  isLoading: boolean;
  /** 聚合端点失败文案；null = 无错误 */
  error: string | null;
  onRetry: () => void;
  /** map 视图组件由 Task 6 注入（避免本文件引 leaflet） */
  map?: (props: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) => ReactNode;
}) {
  if (view === 'trips') {
    return <TripsView moments={moments} chainPayload={chainPayload} hasMore={hasMore} />;
  }
  if (isLoading && !aggregate) {
    return <p className="py-8 text-center text-meta text-muted">加载中…</p>;
  }
  if (error && !aggregate) {
    return (
      <div className="py-4">
        <Banner tone="error" action={{ label: '重试', onPress: onRetry }}>
          {error}
        </Banner>
      </div>
    );
  }
  if (view === 'map') {
    return <>{aggregate?.view === 'map' && map?.({ aggregate })}</>;
  }
  if (!aggregate) return null; // 防御兜底：loading/error 分支已覆盖正常路径
  if (aggregate.view === 'curve') return <CurveView aggregate={aggregate} />;
  if (aggregate.view === 'milestone-axis') return <MilestoneAxisView aggregate={aggregate} />;
  if (aggregate.view === 'moodline') return <MoodlineView aggregate={aggregate} />;
  return null;
}
