import { useState } from 'react';
import type { MonthIndexEntry, TagResponse } from '@moment/dto';
import { monthBeforeParam, monthFromBefore } from '@/lib/time';
import { Button } from '@/ui/button/index';
import { Sheet } from '@/ui/modal/index';

/** 右栏筛选值：before 为日期锚定（spec §4.2，仅 happened_at 序有意义）。 */
export type RailFilter = {
  chainIds?: string[];
  tagId?: string;
  order: 'happened_at' | 'created_at';
  before?: string;
  personId?: string;
  /** 清除 chip 展示用，不进 FeedQuery */
  personName?: string;
  place?: string;
};

/**
 * 时间索引 + 筛选右栏（C 端总规范 §7），一个组件两种呈现：
 * - ≥1400px：视口右侧 fixed aside（宽 --rail，与 Shell 预留的 pr-[--rail] 对齐）；
 * - <1400px：主列顶部月份入口按钮，点开 Sheet（与桌面同一份 RailContent，不另写数据）。
 * 跳转语义（spec §4.3）：点月份 → before = 该月下一月月初（本地）换算 UTC ISO，
 * 页面换 query key 重查，不做双向滚动；「回到最新」由页面渲染，清 before。
 * 纯受控（spec §2）：index/tags 数据由页面 Service 传入，组件不自查。
 */
export function TimelineRail({
  fixedChainId,
  index,
  indexPending,
  tags,
  value,
  onChange,
  pinBelowCover = false,
}: {
  /** 链页传入：链 chips 整块隐藏，索引/标签范围固定为该链 */
  fixedChainId?: string;
  index: MonthIndexEntry[];
  indexPending: boolean;
  tags: TagResponse[];
  value: RailFilter;
  onChange: (next: RailFilter) => void;
  /** 链首页有封面时从封面下沿（30vh）起固定，避免叠在图上 */
  pinBelowCover?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* <1400px：主列顶部月份入口（spec §7.2：入口显示当前月份） */}
      <div className="mb-4 flex justify-end min-[1400px]:hidden">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {new Date().getMonth() + 1}月
        </Button>
      </div>
      {/* <1400px：时间索引 Sheet（与桌面同一份内容） */}
      <Sheet open={open} title="时间索引" onRequestClose={() => setOpen(false)}>
        <RailContent
          fixedChainId={fixedChainId}
          index={index}
          indexPending={indexPending}
          tags={tags}
          value={value}
          onChange={onChange}
        />
      </Sheet>
      {/* ≥1400px：右侧栏 */}
      <aside
        className={
          pinBelowCover
            ? 'fixed top-[30vh] bottom-0 right-0 z-10 hidden w-rail overflow-y-auto px-4 pt-6 min-[1400px]:block'
            : 'fixed inset-y-0 right-0 z-10 hidden w-rail overflow-y-auto px-4 pt-8 min-[1400px]:block'
        }
      >
        <h2 className="mb-3 px-1 text-caption text-muted">时间索引</h2>
        <RailContent
          fixedChainId={fixedChainId}
          index={index}
          indexPending={indexPending}
          tags={tags}
          value={value}
          onChange={onChange}
        />
      </aside>
    </>
  );
}

/**
 * 跨年结构（spec §7.1）：「年份是章节、月份是入口」。今年与当前查看年份
 * （before 锚定月所在年）展开月份；其它年份折叠为一行，点击只展开一个
 * 历史年份。跨年只靠字级与留白表达，不画横向分隔线。
 */
function RailContent({
  fixedChainId,
  index,
  indexPending,
  tags,
  value,
  onChange,
}: {
  fixedChainId?: string;
  index: MonthIndexEntry[];
  indexPending: boolean;
  tags: TagResponse[];
  value: RailFilter;
  onChange: (next: RailFilter) => void;
}) {
  // 手动展开的历史年份：一次只展开一个（spec §7.1）
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

  // 标签 chips 仅在范围恰好一条链时显示：标签挂在单链上，「全部链」/多选下标签来源无定义
  //（本计划定稿规则，与 web-product「/ 无标签条」一致）
  const scopeChainId = fixedChainId ?? (value.chainIds?.length === 1 ? value.chainIds[0] : undefined);
  const anchored = value.before ? monthFromBefore(value.before) : undefined;

  const toggleTag = (id: string) =>
    onChange({ ...value, tagId: value.tagId === id ? undefined : id });
  const orderOn = value.order === 'created_at';
  const toggleOrder = () =>
    // 切序即清锚定：before 仅 happened_at 语义（dto BEFORE_REQUIRES_HAPPENED_AT）
    onChange({ ...value, order: orderOn ? 'happened_at' : 'created_at', before: undefined });

  const currentYear = new Date().getFullYear();
  const anchoredYear = anchored ? Number(anchored.split('-')[0]) : undefined;
  // index 按月份倒序到达，Map 归并保序 → 年份章节同样倒序
  const years = new Map<number, MonthIndexEntry[]>();
  for (const entry of index) {
    const year = Number(entry.month.split('-')[0]);
    const list = years.get(year);
    if (list) list.push(entry);
    else years.set(year, [entry]);
  }
  const isOpen = (year: number) => year === currentYear || year === anchoredYear || year === expandedYear;

  return (
    <>
      <section>
        {value.order === 'created_at' ? (
          <p className="px-1 text-caption text-muted">按添加时间看的时候没有月份索引</p>
        ) : indexPending ? (
          <p className="px-1 text-caption text-muted">索引加载中…</p>
        ) : index.length === 0 ? (
          <p className="px-1 text-caption text-muted">还没有月份可跳</p>
        ) : (
          <div className="flex flex-col gap-4">
            {[...years.entries()].map(([year, months]) =>
              isOpen(year) ? (
                <section key={year} aria-label={`${year}年`}>
                  <h3 className="mb-1 flex items-baseline justify-between px-1">
                    <span className="text-meta font-medium text-ink">{year}</span>
                    {year === currentYear && <span className="text-caption text-muted">今年</span>}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {months.map((mo) => {
                      const active = anchored === mo.month;
                      return (
                        <li key={mo.month}>
                          <button
                            type="button"
                            onClick={() => onChange({ ...value, before: monthBeforeParam(mo.month) })}
                            className={`flex w-full items-baseline justify-between rounded-menu-item px-2 py-1.5 text-meta transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset ${
                              active
                                ? 'bg-[color-mix(in_srgb,var(--select)_24%,transparent)] font-semibold text-ink'
                                : 'text-muted hover:bg-floating-hover hover:text-ink'
                            }`}
                          >
                            {/* 年份已由章节承担，月份条目只写「N月」；含数字，不用 font-display */}
                            <span>{Number(mo.month.split('-')[1])}月</span>
                            <span className="text-caption tabular-nums text-muted">{mo.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : (
                <button
                  key={year}
                  type="button"
                  onClick={() => setExpandedYear(year)}
                  className="flex w-full items-baseline justify-between rounded-menu-item px-2 py-1.5 text-meta text-muted transition-colors duration-[var(--ease)] hover:bg-floating-hover hover:text-ink focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset"
                >
                  <span>{year}</span>
                  <span aria-hidden>›</span>
                </button>
              ),
            )}
          </div>
        )}
      </section>

      <section className="mt-6">
        {scopeChainId && tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <h3 className="w-full px-1 text-caption text-muted">标签</h3>
            <button
              type="button"
              onClick={() => onChange({ ...value, tagId: undefined })}
              className={`${chip} ${value.tagId === undefined ? chipOn : chipOff}`}
            >
              全部
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.id)}
                className={`${chip} ${value.tagId === t.id ? chipOn : chipOff}`}
              >
                #{t.name}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={orderOn}
          onClick={toggleOrder}
          className="mt-3 flex w-full items-center justify-between gap-2 text-left text-meta text-muted transition-colors duration-[var(--ease)] hover:text-ink focus-visible:outline-none focus-visible:ring-focus"
        >
          按记下的顺序看
          <span
            aria-hidden
            className={`flex h-5 w-8 shrink-0 items-center rounded-full px-0.5 transition-colors duration-[var(--ease)] ${
              orderOn ? 'justify-end bg-action' : 'justify-start bg-line'
            }`}
          >
            <span className="h-4 w-4 rounded-full bg-surface" />
          </span>
        </button>
      </section>
    </>
  );
}

/** 筛选 chips：选中 --select 轻强调色面、未选中 1px --line 描边；不复用正文内 Tag 样式（spec §10）。 */
const chip =
  'rounded-full border px-3 py-1 text-caption transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus';
const chipOn = 'border-transparent bg-select text-select-fg';
const chipOff = 'border-line text-ink hover:bg-floating-hover';
