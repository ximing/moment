import { useState } from 'react';
import type { MonthIndexEntry, TagResponse } from '@moment/dto';
import { monthBeforeParam, monthFromBefore } from '@/lib/time';

/** 右栏筛选值：before 为日期锚定（spec §4.2，仅 happened_at 序有意义）。 */
export type RailFilter = {
  chainIds?: string[];
  tagId?: string;
  order: 'happened_at' | 'created_at';
  before?: string;
};

/**
 * 时间索引 + 筛选右栏（spec §4），一个组件三种呈现：
 * - ≥1400px：flex 行内右侧 aside（上索引下筛选）；
 * - <1400px：主列顶部「筛选 / 索引」贴纸按钮点开右侧抽屉（按钮 order-first + w-full，
 *   依赖页面外层 flex flex-wrap；与右下 FAB 空间分离——按钮在主列顶部，不是悬浮球）。
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
}: {
  /** 链页传入：链 chips 整块隐藏，索引/标签范围固定为该链 */
  fixedChainId?: string;
  index: MonthIndexEntry[];
  indexPending: boolean;
  tags: TagResponse[];
  value: RailFilter;
  onChange: (next: RailFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <RailContent
      fixedChainId={fixedChainId}
      index={index}
      indexPending={indexPending}
      tags={tags}
      value={value}
      onChange={onChange}
    />
  );
  return (
    <>
      {/* <1400px：主列顶部触发按钮 */}
      <div className="mb-3 flex justify-end min-[1400px]:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-sticker bg-surface px-3 py-1.5 text-[13px] text-ink elev-sm"
        >
          {new Date().getMonth() + 1}月
        </button>
      </div>
      {/* <1400px：右侧抽屉（遮罩 30% 墨用 color-mix：var() 色值的 /30 修饰静默不生成） */}
      {open && (
        <div className="min-[1400px]:hidden">
          <div
            className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ink)_30%,transparent)]"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-l border-stroke bg-bg p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-medium">回到某个月</span>
              <button type="button" className="text-sm text-muted" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <div className="space-y-6">{content}</div>
          </div>
        </div>
      )}
      {/* ≥1400px：右侧栏 */}
      <aside className="fixed inset-y-0 right-0 z-10 hidden w-[148px] overflow-y-auto px-3 pt-7 min-[1400px]:block">
        {content}
      </aside>
    </>
  );
}

/** '2026-08' → '2026年8月'（含数字，不用 font-display：得意黑子集无数字字形）。 */
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

const chip = 'rounded-sticker px-2.5 py-0.5 text-xs';
const chipOn = 'bg-select text-select-fg';
const chipOff = 'bg-surface text-ink shadow-sticker';

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

  return (
    <>
      <section>
        <h3 className="mb-2 px-1 text-[12px] text-muted">回到某个月</h3>
        {value.order === 'created_at' ? (
          <p className="px-1 text-xs text-muted">按添加时间看的时候没有月份索引</p>
        ) : indexPending ? (
          <p className="px-1 text-xs text-muted">索引加载中…</p>
        ) : index.length === 0 ? (
          <p className="px-1 text-xs text-muted">还没有月份可跳</p>
        ) : (
          <ul className="space-y-1.5">
            {index.map((mo) => {
              const active = anchored === mo.month;
              return (
                <li key={mo.month}>
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, before: monthBeforeParam(mo.month) })}
                    className={`flex w-full items-baseline justify-between py-1.5 text-sm ${
                      active ? 'font-semibold text-ink' : 'text-muted hover:text-ink'
                    }`}
                  >
                    <span>{monthLabel(mo.month)}</span>
                    <span className="text-xs text-muted">{mo.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        {scopeChainId && tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <h3 className="w-full px-1 text-[12px] text-muted">标签</h3>
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
          className="mt-3 flex w-full flex-col items-start gap-2 text-left text-sm text-muted"
        >
          按记下的顺序看
          <span
            aria-hidden
            className={`relative inline-flex h-5 w-[34px] items-center rounded-full ${
              orderOn ? 'bg-[var(--today)]' : 'bg-line'
            }`}
          >
            <span className={`h-4 w-4 rounded-full bg-surface shadow-sticker ${orderOn ? 'ml-3.5' : 'ml-0.5'}`} />
          </span>
        </button>
      </section>
    </>
  );
}
