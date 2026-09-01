# Web 便利贴相册网格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Web 时间线主列从日子线 list+item 换成按月分包的异形便利贴网格，右栏时间索引与全部 HTTP/dto 契约不变。

**Architecture:** 纯函数先定月分组与卡片 span/倾角；`MomentSheet` 改成纸面+面子+纸边三层（网格上不再展开评论、不放表情条）；`Timeline` 按月渲染 CSS Grid `dense`；Shell / 链首页 / 分享页放开 760 阅读列。不改 `tokens.css`、Tailwind 映射、Feedback 基元、compose 面板、rail 跳转语义。

**Tech Stack:** Vite + React 19 + Tailwind（只消费已发布 token）+ @rabjs/react + Vitest + Testing Library。Web 相对 import **不**加 `.js` 后缀。

**Spec:** `docs/superpowers/specs/2026-09-01-web-sticky-note-album-design.md`。权威边界仍听 `2026-08-15-moment-design.md`（API）与 `2026-08-28-moment-people-place-design.md`（人物/地点与分享红线）。C 端总规范在时间线主列上的日子线/无阴影卡片规则以本 spec 为准。

## Global Constraints

- 不修改 `packages/dto/**`、`apps/server/**`、`packages/api-client/**`、compose 面板、`timeline-rail.tsx` 的 `before` 语义。
- 不修改 `apps/web/package.json` scripts、`vitest.config.ts`、`src/test/setup.ts`、`tokens.css`、`tailwind.config.js`、`apps/web/src/ui/feedback/**`（相册骨架新建在 `timeline/`，不回写 `TimelineSkeleton`）。
- 禁止页面十六进制颜色、禁止新 token、禁止 `--elev` / `--shadow` / `--floating-shadow`。便利贴阴影与面子高度只写在 `moment-sheet.css`。
- 间距只使用 4/8/12/16/20/24/32；主列网格 `gap-3`（12px）。列数用已有断点：`grid-cols-2 min-[900px]:grid-cols-3 min-[1400px]:grid-cols-4`。
- 测试：`pnpm --filter @moment/web test -- <file>`，禁止 `pnpm test` 打到 server、禁止 `resetDb()`。
- App 列表不在本计划。

---

## File ownership map

| Owner task | Files | Consumers |
|---|---|---|
| 1 | Create `apps/web/src/timeline/group-by-month.ts` + `group-by-month.test.ts` | 4 |
| 2 | Create `apps/web/src/timeline/note-layout.ts` + `note-layout.test.ts` | 3, 4 |
| 3 | Modify `moment-sheet.tsx` / `moment-sheet.service.ts`；Create `moment-sheet.css`；Modify `moment-sheet-people-place.test.tsx` | 4, 5 |
| 4 | Modify `timeline.tsx` + `timeline.test.tsx`；Create `album-skeleton.tsx` | 5 |
| 5 | Modify `Shell.tsx`、`feed-home/index.tsx`、`chain-home/index.tsx`、`share-album/index.tsx`、`pages/moment/index.tsx`；Modify `shell-navigation.test.tsx`、`chain-home.test.tsx`、`timeline-variants.test.tsx` | — |

`groupMomentsByDate` 保留不删（本计划主列不再调用）。`ComposerEntry` 文件保留，本计划只停止把它传入 `Timeline`。

---

### Task 1: 按墙钟月分组

**Files:**

- Create: `apps/web/src/timeline/group-by-month.ts`
- Test: `apps/web/src/timeline/group-by-month.test.ts`

**Interfaces:**

- Consumes: `localDateKey(iso: string, tzOffsetMinutes: number): string` from `@/lib/time`；`PublicShareMoment` from `@moment/dto`。
- Produces:

```ts
export interface MonthGroup {
  /** YYYY-MM */
  month: string;
  moments: PublicShareMoment[];
}
export function groupMomentsByMonth(
  moments: PublicShareMoment[],
  order?: 'happened_at' | 'created_at',
): MonthGroup[];
export function monthHeading(month: string): string;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/timeline/group-by-month.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PublicShareMoment } from '@moment/dto';
import { groupMomentsByMonth, monthHeading } from './group-by-month';

function m(partial: Partial<PublicShareMoment> & Pick<PublicShareMoment, 'id' | 'happenedAt' | 'createdAt'>): PublicShareMoment {
  return {
    chainId: 'c-1',
    author: { id: 'u-1', nickname: '林', avatarUrl: null },
    type: 'text',
    kind: 'standard',
    payload: null,
    content: '',
    transcript: null,
    transcriptionStatus: null,
    happenedTzOffset: -480,
    isBackfill: false,
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...partial,
  };
}

describe('groupMomentsByMonth', () => {
  it('按 happened_at 墙钟月归并，跨页同一月只一组、组内保持传入顺序', () => {
    const a = m({ id: 'a', happenedAt: '2026-08-31T16:00:00.000Z', createdAt: '2026-08-31T16:00:00.000Z' }); // 东八 9/1 00:00
    const b = m({ id: 'b', happenedAt: '2026-08-01T16:00:00.000Z', createdAt: '2026-08-01T16:00:00.000Z' }); // 东八 8/2
    const c = m({ id: 'c', happenedAt: '2026-08-20T02:00:00.000Z', createdAt: '2026-08-20T02:00:00.000Z' }); // 东八 8/20
    const groups = groupMomentsByMonth([a, b, c]);
    expect(groups.map((g) => g.month)).toEqual(['2026-09', '2026-08']);
    expect(groups[1]!.moments.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('order=created_at 用 createdAt + happenedTzOffset 墙钟月', () => {
    const late = m({
      id: 'late',
      happenedAt: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-09-01T02:00:00.000Z',
    });
    expect(groupMomentsByMonth([late], 'created_at')[0]!.month).toBe('2026-09');
  });
});

describe('monthHeading', () => {
  it('YYYY-MM → 「2026 · 9 月」', () => {
    expect(monthHeading('2026-09')).toBe('2026 · 9 月');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moment/web test -- src/timeline/group-by-month.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/timeline/group-by-month.ts`:

```ts
import type { PublicShareMoment } from '@moment/dto';
import { localDateKey } from '@/lib/time';

export interface MonthGroup {
  month: string;
  moments: PublicShareMoment[];
}

export function groupMomentsByMonth(
  moments: PublicShareMoment[],
  order: 'happened_at' | 'created_at' = 'happened_at',
): MonthGroup[] {
  const byMonth = new Map<string, PublicShareMoment[]>();
  for (const moment of moments) {
    const day =
      order === 'created_at'
        ? localDateKey(moment.createdAt, moment.happenedTzOffset)
        : localDateKey(moment.happenedAt, moment.happenedTzOffset);
    const month = day.slice(0, 7);
    const list = byMonth.get(month);
    if (list) list.push(moment);
    else byMonth.set(month, [moment]);
  }
  return [...byMonth.entries()].map(([month, list]) => ({ month, moments: list }));
}

export function monthHeading(month: string): string {
  const [year, mm] = month.split('-');
  return `${year} · ${Number(mm)} 月`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moment/web test -- src/timeline/group-by-month.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/timeline/group-by-month.ts apps/web/src/timeline/group-by-month.test.ts
git commit -m "feat(web): group timeline moments by wall-clock month"
```

---

### Task 2: 便利贴 span / 面子高度 / 倾角

**Files:**

- Create: `apps/web/src/timeline/note-layout.ts`
- Test: `apps/web/src/timeline/note-layout.test.ts`

**Interfaces:**

- Consumes: `PublicShareMoment`、`MomentMedia`。
- Produces:

```ts
export type NoteColSpan = 1 | 2;
export type NoteFaceHeight = 168 | 192 | 240 | null;
export function noteColSpan(moment: PublicShareMoment): NoteColSpan;
export function noteFaceHeight(moment: PublicShareMoment): NoteFaceHeight;
export function noteTiltDeg(id: string, reducedMotion: boolean): -2 | -1 | 0 | 1 | 2;
export function firstImage(moment: PublicShareMoment): MomentMedia | undefined;
export function firstVideo(moment: PublicShareMoment): MomentMedia | undefined;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/timeline/note-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MomentMedia, PublicShareMoment } from '@moment/dto';
import { noteColSpan, noteFaceHeight, noteTiltDeg } from './note-layout';

function img(partial: Partial<MomentMedia> & Pick<MomentMedia, 'id' | 'width' | 'height'>): MomentMedia {
  return {
    url: '/x',
    mime: 'image/jpeg',
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: null,
    posterDerivedUrl: null,
    ...partial,
  };
}

function base(over: Partial<PublicShareMoment>): PublicShareMoment {
  return {
    id: 'm-1',
    chainId: 'c-1',
    author: { id: 'u-1', nickname: '林', avatarUrl: null },
    type: 'text',
    kind: 'standard',
    payload: null,
    content: '',
    transcript: null,
    transcriptionStatus: null,
    happenedAt: '2026-09-01T00:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...over,
  };
}

describe('noteColSpan / noteFaceHeight', () => {
  it('video → span 2 高度 192', () => {
    const m = base({ type: 'video', media: [img({ id: 'v', width: 1920, height: 1080, mime: 'video/mp4' })] });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceHeight(m)).toBe(192);
  });

  it('2–9 张图 → span 2 高度 168', () => {
    const m = base({
      type: 'media',
      media: [img({ id: 'a', width: 100, height: 100 }), img({ id: 'b', width: 100, height: 100 })],
    });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceHeight(m)).toBe(168);
  });

  it('横图 width/height ≥ 1.4 → span 2 高度 192', () => {
    const m = base({ type: 'media', media: [img({ id: 'w', width: 1400, height: 1000 })] });
    expect(noteColSpan(m)).toBe(2);
    expect(noteFaceHeight(m)).toBe(192);
  });

  it('竖图 height/width ≥ 1.25 → span 1 高度 240', () => {
    const m = base({ type: 'media', media: [img({ id: 'p', width: 1000, height: 1250 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceHeight(m)).toBe(240);
  });

  it('方图 0.9–1.1 → span 1 高度 192', () => {
    const m = base({ type: 'media', media: [img({ id: 's', width: 1000, height: 1000 })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceHeight(m)).toBe(192);
  });

  it('voice / text → span 1 高度 null', () => {
    expect(noteColSpan(base({ type: 'voice' }))).toBe(1);
    expect(noteFaceHeight(base({ type: 'voice' }))).toBeNull();
    expect(noteFaceHeight(base({ type: 'text' }))).toBeNull();
  });

  it('缺宽高的单图 → span 1 高度 168', () => {
    const m = base({ type: 'media', media: [img({ id: 'u', width: null, height: null })] });
    expect(noteColSpan(m)).toBe(1);
    expect(noteFaceHeight(m)).toBe(168);
  });
});

describe('noteTiltDeg', () => {
  it('同一 id 两次结果相同，且 ∈ {-2,-1,0,1,2}', () => {
    const a = noteTiltDeg('m-abc', false);
    expect(a).toBe(noteTiltDeg('m-abc', false));
    expect([-2, -1, 0, 1, 2]).toContain(a);
  });

  it('reducedMotion 时恒 0', () => {
    expect(noteTiltDeg('m-abc', true)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moment/web test -- src/timeline/note-layout.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/timeline/note-layout.ts`:

```ts
import type { MomentMedia, PublicShareMoment } from '@moment/dto';

export type NoteColSpan = 1 | 2;
export type NoteFaceHeight = 168 | 192 | 240 | null;

export function firstImage(moment: PublicShareMoment): MomentMedia | undefined {
  return moment.media.find((x) => x.mime.startsWith('image/'));
}

export function firstVideo(moment: PublicShareMoment): MomentMedia | undefined {
  return moment.media.find((x) => x.mime.startsWith('video/'));
}

function ratio(media: MomentMedia | undefined): number | null {
  if (!media || !media.width || !media.height) return null;
  return media.width / media.height;
}

export function noteColSpan(moment: PublicShareMoment): NoteColSpan {
  if (moment.type === 'video') return 2;
  const images = moment.media.filter((x) => x.mime.startsWith('image/'));
  if (moment.type === 'media' && images.length >= 2) return 2;
  const r = ratio(images[0]);
  if (r !== null && r >= 1.4) return 2;
  return 1;
}

export function noteFaceHeight(moment: PublicShareMoment): NoteFaceHeight {
  if (moment.type === 'voice' || moment.type === 'text') return null;
  if (moment.type === 'video') return 192;
  const images = moment.media.filter((x) => x.mime.startsWith('image/'));
  if (images.length >= 2) return 168;
  const r = ratio(images[0]);
  if (r === null) return 168;
  if (r >= 1.4) return 192;
  if (r > 0 && 1 / r >= 1.25) return 240;
  if (r >= 0.9 && r <= 1.1) return 192;
  return 168;
}

export function noteTiltDeg(id: string, reducedMotion: boolean): -2 | -1 | 0 | 1 | 2 {
  if (reducedMotion) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 5;
  return ([-2, -1, 0, 1, 2] as const)[h]!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moment/web test -- src/timeline/note-layout.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/timeline/note-layout.ts apps/web/src/timeline/note-layout.test.ts
git commit -m "feat(web): derive sticky-note grid span and tilt"
```

---

### Task 3: MomentSheet 改成便利贴

**Files:**

- Create: `apps/web/src/timeline/moment-sheet.css`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.service.ts`（删除评论预览：`showComments`、`preview`、`previewText`、`loadPreview`、`refreshPreview`、`submitPreviewComment` 及 `comment:changed` 订阅）
- Modify: `apps/web/src/timeline/moment-sheet-people-place.test.tsx`
- Test: Create `apps/web/src/timeline/moment-sheet.note.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `noteColSpan` / `noteFaceHeight` / `noteTiltDeg` / `firstImage` / `firstVideo`；`cardDisplayUrl` / `posterDisplayUrl` from `@/lib/media-src`；`AudioBar`；`formatHappenedClock`；`ChainMark`；现有 `MomentSheetMoment` 类型。
- Produces: `MomentSheet` / `MomentSheetContent` 仍导出；props 在现有基础上增加可选 `onTagFilter?: (tag: { id: string; name: string }) => void`。网格上不渲染 `ReactionBar`、不展开评论。`article` 带 `data-span={1|2}`。

- [ ] **Step 1: Write the failing tests**

Rewrite `moment-sheet-people-place.test.tsx` 四个用例为纸边规则（失败是因为现实现还是 chip + AI 角标）：

1. 纯文字 + 人物 + 地点：`getByLabelText('和谁在一起')` 含「爸爸 · 外婆」，**没有**「AI」二字；`getByText('📍 外婆家')` 在纸边（无面子图）。
2. `place.name === null`：无 `📍`。
3. 公开分享（去掉 persons/place 键）：无人、无地点。
4. 传入 `onPersonFilter` / `onPlaceFilter`：人物/地点是 button，点击回调；**无**「AI」角标。

Create `apps/web/src/timeline/moment-sheet.note.test.tsx`（同样 `vi.mock('@/api/client')` + `register` Auth/Compose/MomentSheetService + `MemoryRouter` + `RSRoot`）：

```ts
it('Tag 与正文同一段 text-meta', () => {
  // moment.tags=[{id:'t1',name:'早餐'}], content='粥洒了一圈'
  expect(screen.getByText('#早餐').closest('p')).toHaveTextContent('#早餐粥洒了一圈');
});

it('超过 3 个人物截成三人加省略号', () => {
  // persons 朵朵 妈妈 爸爸 奶奶
  expect(screen.getByLabelText('和谁在一起')).toHaveTextContent('朵朵 · 妈妈 · 爸爸…');
});

it('有图时地点叠在面子上、纸边 meta 不再重复 📍', () => {
  // type media, 一张图, place.name='厨房'
  expect(screen.getByText('📍 厨房').closest('.note-face')).not.toBeNull();
});

it('commentCount=0 不显示回应；>0 显示「N 回应」且是链到 /moments/:id 的链接', () => {
  expect(screen.queryByText(/回应/)).toBeNull(); // 0
  // 另渲 commentCount: 2
  expect(screen.getByRole('link', { name: /2 回应/ })).toHaveAttribute('href', '/moments/m-1');
});

it('readOnly 不渲染表情入口', () => {
  expect(screen.queryByRole('button', { name: '加个表情' })).toBeNull();
});

it('data-span 来自 noteColSpan', () => {
  expect(screen.getByRole('article')).toHaveAttribute('data-span', '1');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @moment/web test -- src/timeline/moment-sheet-people-place.test.tsx src/timeline/moment-sheet.note.test.tsx
```

Expected: people-place 旧断言先红（或你先改测试再跑，红在新断言「无 AI」失败）；`moment-sheet.note.test.tsx` FAIL。

- [ ] **Step 3: Write minimal implementation**

`moment-sheet.css`（唯一阴影与面子高度落点）：

```css
.moment-note {
  position: relative;
  width: 100%;
  padding: 8px;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--ink) 12%, transparent);
  transform: rotate(var(--tilt, 0deg));
  transition: transform var(--ease), box-shadow var(--ease);
  text-align: left;
}
.moment-note:hover,
.moment-note:focus-visible {
  transform: rotate(0deg) translateY(-4px);
  outline: none;
}
.moment-note:focus-visible {
  box-shadow:
    0 8px 22px color-mix(in srgb, var(--ink) 12%, transparent),
    0 0 0 var(--focus-ring-w) var(--focus);
}
.moment-note-face {
  position: relative;
  overflow: hidden;
  border-radius: calc(var(--radius-md) - 4px);
}
.moment-note-face-168 { height: 168px; }
.moment-note-face-192 { height: 192px; }
.moment-note-face-240 { height: 240px; }
.moment-note-face img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.moment-note-place {
  position: absolute;
  left: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--surface);
  text-shadow: 0 1px 6px color-mix(in srgb, var(--ink) 70%, transparent);
}
.moment-note-writing { padding: 8px 4px 2px; }
.moment-note-body {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.moment-note-text .moment-note-body { -webkit-line-clamp: 5; }
@media (prefers-reduced-motion: reduce) {
  .moment-note,
  .moment-note:hover,
  .moment-note:focus-visible {
    transform: none;
    transition: none;
  }
}
```

`moment-sheet.tsx` 要点（完整改写 `MomentSheetContent` 的 return，保留 Lightbox / AlertDialog / kebab）：

- 根：`<article className="moment-note ..." data-span={noteColSpan(moment)} style={{ ['--tilt' as string]: `${noteTiltDeg(moment.id, false)}deg` }}>`。class 加 `moment-note-text` 当 `type==='text'`。
- 导入 `./moment-sheet.css`。
- **面子：** `media`/`video` 用 `<button type="button" className="moment-note-face moment-note-face-{height}" aria-label="查看媒体" onClick={() => service.lightboxIndex = 0}>`。图 `src={cardDisplayUrl(firstImage) 或 posterDisplayUrl(firstVideo)}`。`images.length>1` 时右下叠 `N`。`type==='video'` 左下「过」圆钮（视觉，点击仍开灯箱；真正播放在灯箱内，与现 MediaBlock 视频路径一致）。地点名非空时面子内 `<span className="moment-note-place">📍 {name}</span>`。
- **voice：** 顶部 `AudioBar`；若有附图，旁侧 88×64 缩略（`w-22` 禁止——用 css `width:88px;height:64px`，88 不是网格档，写在 css `.moment-note-voice-thumb`）。无地点叠图：地点走纸边。
- **纸边 writing：**
  - 第一行 `<p className="moment-note-body text-meta text-ink">`：每个 tag 若 `onTagFilter` 则 `<button className="text-tag">#{name}</button>` 否则 `<span className="text-tag">#{name}</span>`，后接 `content`，后接 kind 摘要（现 `summarizePayload` 判重逻辑保留）。
  - 第二行 `<p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted">`：人物 `aria-label="和谁在一起"`，最多 3 名 ` · ` 连接，超出加 `…`，无「AI」二字；无面子图时的地点按钮/文字；`<span>{author} · {formatHappenedClock}{补记}{ageLabel}</span>`；`commentCount>0` 且非 `readOnly` 时 `<Link to={`/moments/${id}`}>N 回应</Link>`，`readOnly` 且 count>0 时只读文字；`chainName && !shareToken` 时 `ChainMark`+`Link`。
- 纸边空白点击：非 `readOnly` 时 wrapping `Link` 到 `/moments/:id` 会把整张纸边变成详情入口；**tag/人物/地点/链名/kebab/面子 button 必须 `e.preventDefault(); e.stopPropagation()`** 或不要放进该 Link。实现：面子与 kebab 在 Link 外；writing 外层 `<Link className="moment-note-writing" to=...>` 仅非 readOnly；filter 按钮 `onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTagFilter(...) }}`。
- 删除 `ReactionBar`、评论预览 form、`showComments` effect。
- kebab 绝对定位 `absolute right-2 top-2 z-10`。
- 不渲染头像列。

`moment-sheet.service.ts` 删评论预览相关字段与方法、构造器里的 `comment:changed` 订阅。保留 `hydrate` / `lightboxIndex` / `confirmDel` / `react` / `remove`。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @moment/web test -- src/timeline/moment-sheet-people-place.test.tsx src/timeline/moment-sheet.note.test.tsx
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/moment-sheet.service.ts apps/web/src/timeline/moment-sheet.css apps/web/src/timeline/moment-sheet-people-place.test.tsx apps/web/src/timeline/moment-sheet.note.test.tsx
git commit -m "feat(web): render moments as sticky-note cards"
```

---

### Task 4: Timeline 按月网格，去掉日子线

**Files:**

- Create: `apps/web/src/timeline/album-skeleton.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`
- Modify: `apps/web/src/timeline/timeline.test.tsx`

**Interfaces:**

- Consumes: `groupMomentsByMonth` / `monthHeading`（Task 1）；`noteColSpan`（Task 2）；`MomentSheet`（Task 3）；现有 `useLoadMoreSentinel`、`Banner`、`InlineProgress`。
- Produces: `Timeline` props 删除 `hideSignature` 与 `entry`；新增 `order?: 'happened_at' | 'created_at'`（默认 `'happened_at'`）、`variant?: 'album' | 'single'`（默认 `'album'`）、`onTagFilter?: (tag: { id: string; name: string }) => void`。`variant='single'` 不渲染月头与网格，只渲一张 `MomentSheet`（详情页用）。

- [ ] **Step 1: Write the failing test**

在 `timeline.test.tsx` 追加（沿用 `MOMENT` / `renderTimeline` / IntersectionObserver stub；**保留**文件顶部对 `MomentSheet` 的 mock——月头由 `Timeline` 自己渲染，不依赖真实卡片）：

```ts
it('按月渲染 region，不出现「今天」日期结和日子线', () => {
  renderTimeline({ moments: [MOMENT] });
  expect(screen.getByRole('region', { name: '2026 · 8 月' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '今天' })).toBeNull();
  expect(document.querySelector('.border-dashed')).toBeNull();
});

it('首屏 pending 且无数据时相册骨架 8 张纸', () => {
  const { container } = renderTimeline({ isPending: true, moments: [] });
  expect(container.querySelectorAll('[data-skeleton-note]').length).toBe(8);
});

it('variant=single 不渲染月头', () => {
  renderTimeline({ moments: [MOMENT], variant: 'single' });
  expect(screen.queryByRole('region', { name: '2026 · 8 月' })).toBeNull();
  expect(screen.getByRole('article')).toBeInTheDocument();
});
```

把原「首屏 pending 渲染骨架」的断言从「任意 aria-hidden」改为骨架 8 张（与上重复则删旧用例）。保留「已有时刻时 pending 不换骨架」。

`album-skeleton.tsx` 尚未存在时本步测试应红。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moment/web test -- src/timeline/timeline.test.tsx`

Expected: FAIL（仍有日子线 / 没有 `2026 · 8 月` region / 骨架不是 8 张）。

- [ ] **Step 3: Write minimal implementation**

`album-skeleton.tsx`：

```tsx
export function AlbumSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-3 min-[1400px]:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          data-skeleton-note
          className="h-40 rounded-surface-md bg-feedback-skeleton"
        />
      ))}
    </div>
  );
}
```

`h-40` = 160px，落在 8 的倍数，仅骨架。

`timeline.tsx`：

- import `groupMomentsByMonth`、`monthHeading`、`AlbumSkeleton`；删除 `groupMomentsByDate`、`dayHeading`、`Line`、`TimelineSkeleton`、`hideSignature`、`entry`。
- props 增加 `order = 'happened_at'`、`variant = 'album'`、`onTagFilter`。
- pending 空列表 → `<AlbumSkeleton />`。
- error 空列表 → 现 Banner。
- 空列表 → `empty`。
- `variant==='single'`：直接 `moments.map` 渲染 `MomentSheet`（传入 onTagFilter / onPersonFilter / onPlaceFilter 等现有 props）。
- 否则：`groupMomentsByMonth(moments, order).map` → `<section aria-label={monthHeading(g.month)}>` + `<h2 className="mb-3 text-caption tracking-wide text-muted">{monthHeading(g.month)}</h2>` + `<div className="grid grid-cols-2 gap-3 [grid-auto-flow:dense] min-[900px]:grid-cols-3 min-[1400px]:grid-cols-4">`。每张 `MomentSheet` 外包 `<div className={noteColSpan(m)===2 ? 'col-span-2' : undefined}>`。
- 哨兵与 `InlineProgress` 放在所有 section 之后。
- 去掉 `relative pl-8` 日子线缩进。
- `lastCreatedId` 的 `grow-in` class 保留在卡片外包。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moment/web test -- src/timeline/timeline.test.tsx`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/timeline/timeline.tsx apps/web/src/timeline/timeline.test.tsx apps/web/src/timeline/album-skeleton.tsx
git commit -m "feat(web): lay out timeline as monthly album grids"
```

---

### Task 5: 加宽主列、接线、改掉旧断言

**Files:**

- Modify: `apps/web/src/shell/Shell.tsx`
- Modify: `apps/web/src/shell/shell-navigation.test.tsx`
- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/pages/share-album/index.tsx`
- Modify: `apps/web/src/pages/moment/index.tsx`
- Modify: `apps/web/src/pages/chain-home/chain-home.test.tsx`
- Modify: `apps/web/src/pages/timeline-variants.test.tsx`

**Interfaces:**

- Consumes: Task 4 的 `Timeline`（`order` / `variant` / `onTagFilter`，无 `entry` / `hideSignature`）；Task 3 的纸边互动；`AlbumSkeleton`。
- Produces: `/` 与精确 `/chains/:chainId` 的 `main` 不再 `max-w-content`；设置页 / 详情 / 通知 / 我的仍是内容列。链首页内层包网格的 `max-w-content` 改为 `w-full`。分享页网格 `main` 去掉 `max-w-content`。详情 `<Timeline variant="single" />`。

- [ ] **Step 1: Write the failing tests**

`shell-navigation.test.tsx` 追加：

```ts
it('大家的日子 main 与链首页一样不加 max-w-content，仍预留 rail 右垫', () => {
  const feed = renderShell('/');
  const feedMain = feed.container.querySelector('main')!;
  expect(feedMain.className.split(/\s+/)).not.toContain('max-w-content');
  expect(feedMain.parentElement!.className).toContain('pr-[var(--rail)]');
  feed.unmount();
});
```

`chain-home.test.tsx`：

- 删除或改写「回应入口文案为 N 条回应，0 条也显示」→ `commentCount===0` 的 IMAGE_MOMENT **没有**「0 回应」；TEXT_MOMENT（1 条）有「1 回应」链接，`href` 含 `/moments/`。
- 删除「表情触发器打开 ReactionPopover」（网格无表情）。改为 `queryByRole('button', { name: '加个表情' })` 为 null。
- 「封面在内容列之外；标题仍在 max-w-content」：改为标题仍在、**网格祖先不再要求 max-w-content**（`closest('.max-w-content')` 对 heading 为 null）。
- `showComments = false` 播种行删除（字段已不存在）。

`timeline-variants.test.tsx`：`sheet.showComments = false` 删除。feed 用例「链来源链接」仍应通过（纸边 ChainMark）。

先跑这些测试，确认红灯来自新断言。

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @moment/web test -- src/shell/shell-navigation.test.tsx src/pages/chain-home/chain-home.test.tsx src/pages/timeline-variants.test.tsx
```

Expected: FAIL（feed 仍 max-w-content；0 回应按钮仍在；加个表情仍在）。

- [ ] **Step 3: Write minimal implementation**

`Shell.tsx`：用 `useMatch({ path: '/', end: true })` 识别 feed。`wideMain = Boolean(feedMatch) || Boolean(useMatch({ path: '/chains/:chainId', end: true }))`。`main` class：`wideMain` 时 `w-full px-5 pb-32 pt-6 min-[900px]:px-8`（链首页封面通栏继续 `w-full pb-32` 且外层不 `pr-rail`，与现在一致）。非 wide 仍 `max-w-content`。feed 外层继续 `pl-sidebar pr-rail`。

`feed-home/index.tsx`：删除 `ComposerEntry` import 与 `entry`；`hideSignature` 改为 `order={service.filter.order}`；`onTagFilter={(tag) => service.setFilter({ ...service.filter, tagId: service.filter.tagId === tag.id ? undefined : tag.id })}`。pending 空列表走 Timeline 内 AlbumSkeleton，页面不必改。

`chain-home/index.tsx`：内层 `max-w-content` 改为 `w-full`（保留 `px-5 pt-6 min-[900px]:px-8`）。删除 `ComposerEntry` / `entry` / `hideSignature`。`order={service.filter.order}`。`onTagFilter` 同上（`ChainHomeService.setFilter`）。链加载中骨架改为 `<AlbumSkeleton />`（import 从 `@/timeline/album-skeleton`），不要 `TimelineSkeleton`。

`share-album/index.tsx`：加载骨架与 `<main>` 去掉 `max-w-content`（`w-full px-6 py-8`）。header 可保持现宽度或同样 `w-full px-6`。Timeline 不传 filter 回调。`readOnly` 已有。

`moment/index.tsx`：`<Timeline variant="single" moments={[moment]} ... />`，外层继续 `max-w-content`。

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @moment/web test -- src/shell/shell-navigation.test.tsx src/pages/chain-home/chain-home.test.tsx src/pages/timeline-variants.test.tsx src/timeline/timeline.test.tsx src/timeline/moment-sheet.note.test.tsx src/timeline/moment-sheet-people-place.test.tsx src/timeline/group-by-month.test.ts src/timeline/note-layout.test.ts
```

Expected: PASS。

再跑：`pnpm --filter @moment/web test`（该包全部）与 `pnpm --filter @moment/web typecheck`。

Expected: 全绿。`chain-home.test.tsx` 只需改 Step 1 列出的三处（回应 / 表情 / max-w-content）和 `showComments` 播种行；不要新增日子线正向断言。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shell/Shell.tsx apps/web/src/shell/shell-navigation.test.tsx apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/chain-home/chain-home.test.tsx apps/web/src/pages/share-album/index.tsx apps/web/src/pages/moment/index.tsx apps/web/src/pages/timeline-variants.test.tsx
git commit -m "feat(web): widen album column and drop day-line composer"
```

---

## 手动验收（Task 5 之后，不单开 commit）

对照 `docs/superpowers/mocks/memory-space/album.html`，本地 `pnpm --filter @moment/web dev`：

1. `/` 与 `/chains/:id`：主列是按月网格，无竖虚线、无「今天」大结、无日子线 composer。
2. 卡片纸感、异形 span、纸边能读到 Tag / 人物 / 地点 / 作者时间 / 回应。
3. 点月份仍跳转（`before`）；点人物/地点/Tag 仍筛选。
4. 点图开灯箱；点「N 回应」或纸边进 `/moments/:id`；网格无表情条，详情页表情仍在。
5. `/share/:token` 无人地点；viewer 无记下。
6. 390 / 1024 / 1440 / 1895 与浅色/深色：列数 2–4，不断字。

---

## Spec coverage

| Spec | Task |
|---|---|
| §2 按月网格、去掉日子线/composer 挂线 | 4, 5 |
| §2 主列不再 760 | 5 |
| §2 created_at 月头 | 1, 4 |
| §3.1 纸面/阴影/倾角/reduced-motion | 2, 3 |
| §3.2 面子类型 | 3 |
| §3.3 地点叠图 vs 纸边 | 3 |
| §3.4 纸边 Tag/人物/作者/回应/链来源；无头像列；无 AI 角标 | 3 |
| §3.5 span 与高度档 | 2, 4 |
| §3.6 互动与无网格表情 | 3, 5 |
| §4 分享红线 | 3, 5 |
| §5 8 张骨架 | 4 |
| §7 测试表 | 1–5 |
| 不改 API / rail / tokens / Feedback 基元 | Global Constraints |

否决项（3D 房间、记忆墙、时间轴）无任务，正确。
