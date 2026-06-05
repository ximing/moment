import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChainDto } from '@moment/dto';
import { client } from '@/api/client';
import { qk } from '@/api/keys';
import { chainColor, stickerClasses } from '@/lib/chain-color';
import { currentTzOffset, monthBeforeParam, monthFromBefore } from '@/lib/time';

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
 */
export function TimelineRail({
  chains,
  fixedChainId,
  value,
  onChange,
}: {
  chains: ChainDto[];
  /** 链页传入：链 chips 整块隐藏，索引/标签范围固定为该链 */
  fixedChainId?: string;
  value: RailFilter;
  onChange: (next: RailFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <RailContent chains={chains} fixedChainId={fixedChainId} value={value} onChange={onChange} />
  );
  return (
    <>
      {/* <1400px：主列顶部触发按钮 */}
      <div className="order-first w-full min-[1400px]:hidden">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-sticker border-2 border-line bg-surface px-3 py-1.5 text-sm text-ink shadow-sticker"
          >
            筛选 / 索引
          </button>
        </div>
      </div>
      {/* <1400px：右侧抽屉（遮罩 30% 墨用 color-mix：var() 色值的 /30 修饰静默不生成） */}
      {open && (
        <div className="min-[1400px]:hidden">
          <div
            className="fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--ink)_30%,transparent)]"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-l-2 border-line bg-bg p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-lg">筛选 / 索引</span>
              <button type="button" className="text-sm text-muted" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <div className="space-y-6">{content}</div>
          </div>
        </div>
      )}
      {/* ≥1400px：右侧栏 */}
      <aside className="hidden w-72 shrink-0 min-[1400px]:block">
        <div className="sticky top-8 max-h-[calc(100vh-4rem)] space-y-6 overflow-y-auto pb-4">
          {content}
        </div>
      </aside>
    </>
  );
}

/** '2026-08' → '2026年8月'（含数字，不用 font-display：得意黑子集无数字字形）。 */
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

const chip = 'rounded-sticker border-2 px-2.5 py-0.5 text-xs';
const chipOn = 'border-line bg-select text-ink shadow-sticker';
const chipOff = 'border-line bg-surface text-ink';

function RailContent({
  chains,
  fixedChainId,
  value,
  onChange,
}: {
  chains: ChainDto[];
  fixedChainId?: string;
  value: RailFilter;
  onChange: (next: RailFilter) => void;
}) {
  // 索引/筛选范围：fixedChainId（链页）优先，否则用所选链集合
  const scopeChainIds = value.chainIds ?? (fixedChainId ? [fixedChainId] : undefined);
  // 标签 chips 仅在范围恰好一条链时显示：标签挂在单链上，「全部链」/多选下标签来源无定义
  //（本计划定稿规则，与 web-product「/ 无标签条」一致）
  const scopeChainId = fixedChainId ?? (value.chainIds?.length === 1 ? value.chainIds[0] : undefined);
  const anchored = value.before ? monthFromBefore(value.before) : undefined;

  const idx = useQuery({
    queryKey: qk.monthIndex({ chainIds: scopeChainIds, tagId: value.tagId, tzOffset: currentTzOffset() }),
    queryFn: () =>
      client.getMonthIndex({ chainIds: scopeChainIds, tagId: value.tagId, tzOffset: currentTzOffset() }),
    // created_at 下 before/月份锚定无意义（dto BEFORE_REQUIRES_HAPPENED_AT），索引块整体替换为说明
    enabled: value.order === 'happened_at',
  });
  const { data: tags } = useQuery({
    queryKey: qk.tags(scopeChainId ?? ''),
    queryFn: () => client.listTags(scopeChainId!),
    enabled: Boolean(scopeChainId),
  });

  const toggleChain = (id: string) => {
    const cur = value.chainIds ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    // 换链范围时清 tagId：标签挂在单链上，跨范围保留无意义
    onChange({ ...value, chainIds: next.length > 0 ? next : undefined, tagId: undefined });
  };
  const toggleTag = (id: string) =>
    onChange({ ...value, tagId: value.tagId === id ? undefined : id });
  const orderOn = value.order === 'created_at';
  const toggleOrder = () =>
    // 切序即清锚定：before 仅 happened_at 语义（dto BEFORE_REQUIRES_HAPPENED_AT）
    onChange({ ...value, order: orderOn ? 'happened_at' : 'created_at', before: undefined });

  return (
    <>
      <section>
        <h3 className="mb-2 px-1 text-[11px] tracking-wide text-muted">时间索引</h3>
        {value.order === 'created_at' ? (
          <p className="px-1 text-xs text-muted">按添加时间看的时候没有月份索引</p>
        ) : idx.isPending ? (
          <p className="px-1 text-xs text-muted">索引加载中…</p>
        ) : (idx.data?.months.length ?? 0) === 0 ? (
          <p className="px-1 text-xs text-muted">还没有月份可跳</p>
        ) : (
          <ul className="space-y-1.5">
            {idx.data!.months.map((mo) => {
              const active = anchored === mo.month;
              return (
                <li key={mo.month}>
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, before: monthBeforeParam(mo.month) })}
                    className={`flex w-full items-baseline justify-between rounded-sticker border-2 px-3 py-1 text-sm ${
                      active ? chipOn : 'border-line bg-surface text-ink hover:bg-select'
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
        <h3 className="mb-2 px-1 text-[11px] tracking-wide text-muted">筛选</h3>
        {!fixedChainId && chains.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ ...value, chainIds: undefined, tagId: undefined })}
              className={`${chip} ${(value.chainIds?.length ?? 0) === 0 ? chipOn : chipOff}`}
            >
              全部链
            </button>
            {chains.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChain(c.id)}
                className={`${chip} inline-flex items-center ${value.chainIds?.includes(c.id) ? chipOn : chipOff}`}
              >
                {/* 链颜色点：同 Shell 侧栏圆点写法（chainColor 确定性推导） */}
                <span
                  aria-hidden
                  className={`mr-1 inline-block h-2 w-2 rounded-full border ${stickerClasses[chainColor(c.id)]}`}
                />
                {c.name}
              </button>
            ))}
          </div>
        )}
        {scopeChainId && (tags?.tags.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ ...value, tagId: undefined })}
              className={`${chip} ${value.tagId === undefined ? chipOn : chipOff}`}
            >
              全部
            </button>
            {tags!.tags.map((t) => (
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
          className="mt-3 flex w-full items-center justify-between rounded-sticker border-2 border-line bg-surface px-3 py-1.5 text-sm text-ink shadow-sticker"
        >
          按添加时间看补发
          <span
            aria-hidden
            className={`inline-flex h-4 w-8 items-center rounded-full border-2 border-line px-0.5 ${
              orderOn ? 'justify-end bg-select' : 'justify-start bg-bg'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-ink" />
          </span>
        </button>
      </section>
    </>
  );
}
