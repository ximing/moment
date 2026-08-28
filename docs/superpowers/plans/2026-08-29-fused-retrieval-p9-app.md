# 融合检索 P9：Expo app chip / 搜索 / 派生图 / 处理中 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的 Expo app 同构：人物/地点 chip 可点过滤、主列 `Field` 搜索走 `POST /api/search`、时间线卡片用派生图而详情大图用原图、链设置 owner「处理中」分区。共享 `@moment/api-client`（P8 已加 `searchMoments` / `listChainJobs` / `FeedQuery` 四键 / `fetchMediaBlob` variant），app **零 fork**。

**Architecture:** 状态仍是 rab 页面 Service（`FeedService` / `ChainHomeService` / `ChainSettingsService`），过滤/搜索态内存字段，不进 URL。app 无 web 的 `RailFilter` 轨组件——冻结名 `RailFilter.personId` / `RailFilter.place` 投影为两个 Service 上的同名字段（另加展示用 `personName`，不进 HTTP）。可单测的纯函数放 `src/lib/`（vitest node，与 gold P6 `exif-gps` 同形）；hook / 组件 / Service 因 expo-constants + SecureStore + rab 无法在 node vitest 跑，门禁走 typecheck + lint + 既有 `pnpm --filter @moment/app test` + DoD 手测。媒体只改 `useMediaUri` 缓存键与卡片通道；详情页固定 original。jobs 是链设置 ScrollView 里的 owner 分区，focus 时 10s 轮询。

**Tech Stack:** Expo 54 / expo-router 6 / React Native 0.81 / React 19 / @rabjs/react 9（Service + observer + bindServices）/ Vitest ^4.1.11（仅纯函数，既有 `"test": "vitest run"`）/ `@moment/dto` + `@moment/api-client` dist。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§6.1 app 链页 `listChainMoments`、§6.2 `searchMoments`、§6.4 `listChainJobs`、§6.5 `useMediaUri` cache key / `fetchMediaBlob` variant、§7.1–§7.4 UX、§8 分享红线在 app 无 UI 面、§9 web/app 测试条目、§11 P9 出口）

**上游契约:**
- P1：`SearchInput` / `SearchParsed` / `SearchTime` / `SearchResponse` / `INTENT_MAX_QUERY_CHARS` / `SEARCH_DEFAULT_LIMIT` / `SEARCH_MAX_LIMIT` / `ChainJobDto` / `ChainJobListResponse` / `MomentMedia.derivedUrl` / `posterDerivedUrl`
- P3：`GET /api/media/:id?variant=derived`；仅 `ready` 才非空 `derivedUrl` / `posterDerivedUrl`；404 `DERIVED_NOT_READY` 不回退原图（客户端 hook 回退）
- P6：`POST /api/search` JSON body；chip AND 仅 `personId`/`tagId`/`place`；**不**带 `before`；`parsed` 每页重算但客户端翻页不覆盖首页摘要
- P7：`GET /api/chains/:chainId/jobs` owner；默认 `pending,failed`；无游标
- P8 CLEAN：`packages/api-client` 已提供 `searchMoments` / `listChainJobs` / `FeedQuery.personId|place|happenedFrom|happenedTo` / `listChainMoments` 四键 / `mediaUrl(id, { variant?, st? })` / `fetchMediaBlob(id, { variant? })`。本计划只消费，不改 `packages/api-client/**`、`packages/dto/**`、`apps/server/**`、`apps/web/**`
- 冻结名：`.superpowers/orchestration/fused-retrieval/spec-review.md`
- 执行时假设 P1–P8 已在本分支落地，且 `@moment/api-client` / `@moment/dto` dist 已 build（缺 `searchMoments` 时先 `pnpm --filter @moment/api-client build`，禁止在 app 里补一套 client）

## Global Constraints（只写本计划新增）

- **禁止 fork 契约：** 不改 `packages/api-client/**`、`packages/dto/**`、`apps/server/**`、`apps/web/**`。不封装 `/api/internal/*`。`BA_AUTH_TOKEN` 不进 app 包。
- **测试纪律（gold P6 + 现网）：** app 现网只有 `src/lib/exif-gps.test.ts` + `"test": "vitest run"`（node，零 RN）。本计划只给 `src/lib/*.ts` 纯函数加 `*.test.ts`。不新增 vitest.config、不改 `apps/app/package.json` scripts、不引入 `@testing-library/react-native`、不写 Service/组件测试（`FeedService` 模块图含 `lib/api.ts` → expo-constants；`ChainHomeService` 还经 `ChainListService` 拉到 `AuthService` + SecureStore）。
- **命令（只使用既有 scripts）：** `pnpm --filter @moment/app test`；聚焦 `pnpm --filter @moment/app test -- src/lib/<file>.test.ts`；门禁 `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app test`（`build` = `tsc --noEmit`，与 typecheck 同）。
- **ESM：** app `moduleResolution: "bundler"`，相对 import **不带** `.js`。
- **样式：** `useTheme()` + 模块级 `createStyles(t)`；禁 hex/rgba（`lint:tokens`）；新文件间距 `space1..space8`、字号 `fontCaption..fontInput`、可交互命中区 ≥ `touchMin`（不足用 `hitSlop` 纵向补，不动视觉 padding）。按钮走 `Button`。不新造设计系统组件（无 SearchBar / Banner / EmptyState——token spec §1.3 明确不做）。
- **Field 不是 SearchBar：** 搜索是既有 `Field` + `returnKeyType="search"` + 可见 Label。RN 无 HTML `type="search"`。
- 过滤态 **不进 URL**。搜索 body **不**出现 `before` / `order` / `source`。month-index / `happenedFrom`/`happenedTo` **不**从 app 发出（app 无日历轨、无区间 UI）。
- `useMediaUri` 缓存键必须是 `` `${mediaId}:${variant}` ``（`variant` 缺省 `'original'`）。`variant==='derived'` 才 `fetchMediaBlob(id, { variant: 'derived' })`；original **单参** `fetchMediaBlob(id)`（与 P8 偏差 17 同：禁止传 `undefined` 第二参）。
- app **无公开分享页**（`lib/api.ts` `webUrl` 注释）：不调用 `mediaUrl(..., { st })`，不拼 `?st=`。
- 那年今日入口与 `/memories/today` **不动**（不挂搜索、卡片 chip 不可点）。
- 每 Task 一个 commit（`feat(app): ...`）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **RN 没有 HTML `type="search"`。** spec §7.2 写「既有 Field + Input/TextField，`type=search`」。app `Field` 已是 `TextInput` 包装并透传 `TextInputProps`。本计划用 `returnKeyType="search"` + `onSubmitEditing` + 可见 Label「搜索时刻」，**禁止**新造名为 `SearchBar` 的组件。
2. **展示用 `personName?: string`。** 冻结名只有 `personId` / `place`。清除 chip「外婆 ×」需要名字，空结果时列表里已没有 `persons[]`。`personName` **不**进 `getFeed` / `listChainMoments` / `searchMoments`。
3. **详情页与往年今日人物/地点仍是 View/Text。** spec §7.1 页级 `personId` 只存在于 feed / chain-home。详情无列表过滤态；那年今日是独立入口（spec §0）。`MomentCard` 的 `onPersonFilter` / `onPlaceFilter` 不传则保持只读（P6 展示）。
4. **链主页非 `timeline` 段不渲染搜索与 FilterChips。** 搜索替换的是 `moments` 时间线；聚合/地图/标签段不消费该列表。
5. **app 不拼 `mediaUrl` / `?st=`。** 冻结「share/st query join same as web helper **if app builds URLs**」。现网媒体只走 `fetchMediaBlob` → 本地文件；分享相册在 web。本计划不引入第二条 URL 通道。
6. **original 的 `fetchMediaBlob` 不传第二参。** 与 P8 偏差 17 同形。
7. **搜索与时间线 `limit` 用现网 `TIMELINE_PAGE_SIZE = 20`，不用 dto `SEARCH_MAX_LIMIT`（50）。** P8 用 50 是因为 web `getFeed(..., 50)`。app feed/链列表现网都是 20；与 `SEARCH_DEFAULT_LIMIT` 对齐。显式传 20，不依赖 server 缺省。
8. **搜索框清空（空串）若当前在搜索模式则 `exitSearch`。** 空 q 不能 POST（`min(1)`）。iOS 用 `clearButtonMode="while-editing"`；Android 靠删光 `onChangeText('')`。
9. **不设 `maxLength`。** 提交 `trim().slice(0, INTENT_MAX_QUERY_CHARS)`；超长先截断再 POST。
10. **`submitSearch` / `exitSearch` 是 `async` 并 `await loadFirst()`。** 与 P8 偏差 15 同。
11. **搜索空态与过滤空态分流。** 搜索：「没有找到相关时刻」+ `Button quiet`「退出搜索」。`personId`/`place`/`tagId` 过滤：「没有符合条件的时刻」。默认仍「还没有时刻」。避免一个「清除」误退出搜索。
12. **jobs 时间 `new Date(createdAt).toLocaleString()`。** 与 P8 偏差 12 / 现网分享链接相对时间不同——jobs 需要对齐 web 处理中列。
13. **app 无 `before` / 月历 /「回到今天」。** web FilterChips 合并了 before chip（P8 偏差 13）。app 时间线没有日期锚定，本计划不新做日历。
14. **链设置是单 ScrollView，不是 web 的 `Section` tab。** spec §7.4「app 链设置同构」。owner 在分享链接与危险区之间插入「处理中」分区；`useFocusEffect` 在设置页获得焦点时 load + 10s 轮询，失焦/unmount 停止（web 靠 tab mount）。**不**把 `loadJobs` 写进 `loadChain`。
15. **不写 Service/组件自动化测试。** gold P6 偏差 4 + 现网 vitest 只有纯函数。契约由 `src/lib` 测试 + typecheck + DoD 手测钉死。
16. **`FeedService.setChainFilter` 切换链时清掉 `personId`/`personName`。** person id 是链作用域；带到另一条链会整页空列表。`place` 是等值字符串，跨链保留。切到「全部链」也清人物（避免误以为全仓同一个人）。
17. **派生失败回退 original 在 `useMediaUri` 内完成**（`fallbackToOriginal: true`），返回值仍 `string | null`。
18. **人物/地点可点 chip 是 `MomentCard` 内嵌套 `Pressable`。** web 卡片不是整卡 button。RN 现网整卡 `Pressable`；内层 Pressable 吃触摸。DoD 手测：点 chip 不进详情。
19. **无 Banner / EmptyState 组件。** 搜索错误用既有 `ErrorText` + `humanError`（`RATE_LIMITED` 已有文案）；摘要用 `Text` + `Button quiet`「关闭」；空态用 `Text`。不 Toast、不 `Alert` 搜失败（与 spec「降级不 Toast」对齐）。
20. **FilterChips 不 sticky 进 FlashList。** 放在列表上方，与现网链/标签 chip 行同层（那些行也不 sticky）。
21. **链主页时间线不加 tag chip。** 标签仍是独立段；搜索 AND 的 `tagId` 在链页恒不传（Service 无该字段）。
22. **不发送 `happenedFrom`/`happenedTo`。** api-client 有这两键供契约完整；app 无区间 UI。
23. **`formatSearchParsed` 在 app `src/lib/search-summary.ts` 自放一份。** 两端无共享 UI lib；文案与 P8 逐字相同，测锁定。
24. **链主页 timeline 多子树后 FlashList 必须自己 `flex:1`。** 现网该段根节点就是 FlashList，作为 `styles.flex` 的最后一个子节点能吃到剩余高度。T4 改成 `timelinePane`（flex:1）里 FilterChips + FlashList 后，FlashList 2 若不设 `style={{flex:1}}`，Android 上列表高度经常塌成 0（筛选项在、卡片没有）。feed 本就是 chips 与 FlashList 兄弟且已能滚，不改 feed 的 FlashList `style`。
25. **搜索错误必须包 padding 容器。** P8 用 Banner（自带内边距）。app 既有 `ErrorText` 只是 danger `Text`。裸插会贴屏幕左缘，和 GET `errorBanner` / `summaryRow` 不对齐。T5 用 `searchBanner`（水平 space3、垂直 space2）。

---

## File map

| 路径 | 职责 |
|---|---|
| `apps/app/src/lib/media-variant.ts` | `mediaCacheKey` / `cardImageVariant` / `posterCardVariant` / `MediaVariant` |
| `apps/app/src/lib/media-variant.test.ts` | 纯函数 |
| `apps/app/src/lib/use-media-uri.ts` | `{ variant, fallbackToOriginal }`；文件名含 variant；derived 失败回退 original |
| `apps/app/src/components/MediaGrid.tsx` | 卡片图 derived；视频封面 `posterDerivedUrl` |
| `apps/app/src/features/moment/index.tsx` | 详情图/视频只 original（Lightbox 同构） |
| `apps/app/src/lib/timeline-query.ts` | `TIMELINE_PAGE_SIZE` / `buildFeedQuery` / `buildChainMomentsQuery` / `buildSearchInput` |
| `apps/app/src/lib/timeline-query.test.ts` | 纯函数：带出 personId/place，永不 personName/before/order/source |
| `apps/app/src/features/feed/feed.service.ts` | `personId`/`personName`/`place` + 搜索模式 |
| `apps/app/src/features/chain-home/chain-home.service.ts` | 同上，`listChainMoments` + 搜索 `chainIds:[current]` |
| `apps/app/src/components/MomentCard.tsx` | 可选回调 → 内层 Pressable；不传则 View |
| `apps/app/src/components/FilterChips.tsx` | 「外婆 ×」「📍 {place} ×」 |
| `apps/app/src/components/TimelineSearchField.tsx` | `Field` + `returnKeyType="search"` |
| `apps/app/src/lib/search-summary.ts` | `formatSearchParsed` |
| `apps/app/src/lib/search-summary.test.ts` | |
| `apps/app/src/features/feed/index.tsx` | 搜索框 + FilterChips + 摘要 + 空态 |
| `apps/app/src/features/chain-home/index.tsx` | 仅 timeline 段 |
| `apps/app/src/lib/job-labels.ts` | `JOBS_POLL_MS` / `jobTypeLabel` / `jobStatusLabel` |
| `apps/app/src/lib/job-labels.test.ts` | |
| `apps/app/src/features/chain-settings/chain-settings.service.ts` | `jobs` / `loadJobs` |
| `apps/app/src/features/chain-settings/jobs-section.tsx` | 列表 + focus 轮询 |
| `apps/app/src/features/chain-settings/index.tsx` | owner 插入分区 |

**本计划明确不改：** `packages/dto/**`、`packages/api-client/**`、`apps/server/**`、`apps/web/**`、`apps/app/package.json`、`src/theme/tokens.ts`、`src/lib/api.ts` 的 client 工厂、那年今日 `features/memories/**`、`backfill:embed`、internal embeddings、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: `mediaCacheKey` + `useMediaUri({ variant })`；derived 失败回退 original

**Files:**
- Create: `apps/app/src/lib/media-variant.ts`
- Test: `apps/app/src/lib/media-variant.test.ts`
- Modify: `apps/app/src/lib/use-media-uri.ts`

**Interfaces:**
- Consumes: P8 `client.fetchMediaBlob(mediaId: string, opts?: { variant?: 'original' | 'derived' }): Promise<Blob>`（经既有 `../../lib/api` 的 `client`）；现网 `useMediaUri(mediaId: string | undefined): string | null`
- Produces:
  - `export type MediaVariant = 'original' | 'derived'`
  - `mediaCacheKey(mediaId: string, variant: MediaVariant): string` — 返回 `` `${mediaId}:${variant}` ``
  - `cardImageVariant(derivedUrl: string | null | undefined): MediaVariant` — 真值 `'derived'`，否则 `'original'`
  - `posterCardVariant(posterDerivedUrl: string | null | undefined): MediaVariant` — 同上
  - `useMediaUri(mediaId: string | undefined, opts?: { variant?: MediaVariant; fallbackToOriginal?: boolean }): string | null`
  - 缓存文件名含 `mediaCacheKey`（禁止 derived 与 original 写同一本地文件）
  - `variant==='derived'` → `client.fetchMediaBlob(mediaId, { variant: 'derived' })`；否则 **单参** `client.fetchMediaBlob(mediaId)`
  - `fallbackToOriginal: true` 且 derived 失败：改打 original，不把死链留给用户
  - `mediaId` 空/undefined：不请求，返回 `null`（现网 VideoCell `posterMediaId ?? undefined` 依赖此）

- [ ] **Step 1: 写失败测试**

Create `apps/app/src/lib/media-variant.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { cardImageVariant, mediaCacheKey, posterCardVariant } from './media-variant';

describe('mediaCacheKey（spec fused-retrieval §6.5）', () => {
  it('键是 mediaId:variant，缺省策略由调用方传入 original', () => {
    expect(mediaCacheKey('m-1', 'original')).toBe('m-1:original');
    expect(mediaCacheKey('m-1', 'derived')).toBe('m-1:derived');
    expect(mediaCacheKey('m-1', 'original')).not.toBe(mediaCacheKey('m-1', 'derived'));
  });
});

describe('cardImageVariant / posterCardVariant（spec §7.3）', () => {
  it('有 derivedUrl / posterDerivedUrl → derived，否则 original；空串当无', () => {
    expect(cardImageVariant('/api/media/m-1?variant=derived')).toBe('derived');
    expect(cardImageVariant(null)).toBe('original');
    expect(cardImageVariant(undefined)).toBe('original');
    expect(cardImageVariant('')).toBe('original');
    expect(posterCardVariant('/api/media/p-1?variant=derived')).toBe('derived');
    expect(posterCardVariant(null)).toBe('original');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/app test -- src/lib/media-variant.test.ts`

Expected: FAIL，`Cannot find module './media-variant'`（或 Failed to resolve import）。既有 `src/lib/exif-gps.test.ts` 不在这条聚焦命令里；不要改它。

- [ ] **Step 3: 最小实现**

Create `apps/app/src/lib/media-variant.ts`：

```ts
/** 媒体变体（spec fused-retrieval §6.5）：卡片 derived / 详情 original，禁止混用同一缓存键。 */
export type MediaVariant = 'original' | 'derived';

export function mediaCacheKey(mediaId: string, variant: MediaVariant): string {
  return `${mediaId}:${variant}`;
}

export function cardImageVariant(derivedUrl: string | null | undefined): MediaVariant {
  return derivedUrl ? 'derived' : 'original';
}

export function posterCardVariant(posterDerivedUrl: string | null | undefined): MediaVariant {
  return posterDerivedUrl ? 'derived' : 'original';
}
```

将 `apps/app/src/lib/use-media-uri.ts` **整文件替换**为：

```ts
import { useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import { client } from './api';
import { mediaCacheKey, type MediaVariant } from './media-variant';

/** GET /api/media/:id 需 Bearer；原生 Image/video 不会带鉴权头，且 source.headers 会跟过 302 被 S3 拒。
 *  fused-retrieval §6.5：缓存键 `${mediaId}:${variant}`，禁止 derived 与 original 共用同一本地文件。
 *  original 走 fetchMediaBlob(id) 单参；derived 才传 { variant: 'derived' }（P8 偏差 17 同形）。 */

export function useMediaUri(
  mediaId: string | undefined,
  opts?: { variant?: MediaVariant; fallbackToOriginal?: boolean },
): string | null {
  const requested: MediaVariant = opts?.variant ?? 'original';
  const fallback = Boolean(opts?.fallbackToOriginal && requested === 'derived');
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (mediaId == null || mediaId.length === 0) return;
    const id = mediaId;
    let cacheFile: File | null = null;
    let alive = true;

    async function load(variant: MediaVariant): Promise<void> {
      const blob =
        variant === 'derived'
          ? await client.fetchMediaBlob(id, { variant: 'derived' })
          : await client.fetchMediaBlob(id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!alive) return;
      // 逻辑键 `${mediaId}:${variant}`（spec §6.5）；文件名把冒号换成连字符，避免 iOS 路径问题
      const dest = new File(Paths.cache, `moment-media-${mediaCacheKey(id, variant).replace(':', '-')}-${Date.now()}`);
      dest.write(bytes);
      cacheFile = dest;
      if (!alive) {
        dest.delete();
        return;
      }
      setUri(dest.uri);
    }

    void load(requested).catch(() => {
      if (!alive) return;
      if (fallback) {
        void load('original').catch(() => undefined);
        return;
      }
    });

    return () => {
      alive = false;
      if (cacheFile?.exists) {
        try {
          cacheFile.delete();
        } catch {
          // 缓存可能已被系统清掉
        }
      }
      setUri(null);
    };
  }, [mediaId, requested, fallback]);

  return uri;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/app test -- src/lib/media-variant.test.ts`

Expected: PASS。再跑 `pnpm --filter @moment/app test`：exif-gps 18 个 it + 本 Task 新用例全绿。

- [ ] **Step 5: 门禁**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint`

Expected: exit 0。既有 `useMediaUri(id)` 单参调用方（AudioBar / 详情）仍合法（第二参可选）。`lint:tokens` 零命中。

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/media-variant.ts apps/app/src/lib/media-variant.test.ts apps/app/src/lib/use-media-uri.ts
git commit -m "feat(app): key media file cache by variant and fall back from derived"
```

---

### Task 2: MediaGrid 卡片用派生图；详情页大图/视频用原图

**Files:**
- Modify: `apps/app/src/components/MediaGrid.tsx`
- Modify: `apps/app/src/features/moment/index.tsx`（`MomentImage` / `VideoBlock` 保持 original 单参；本 Task 只加一句注释钉死语义，**不**把 derived 传进详情）

**Interfaces:**
- Consumes: Task 1 `useMediaUri` / `cardImageVariant` / `posterCardVariant`；P3 `MomentMedia.derivedUrl` / `posterDerivedUrl`（仅 ready 非空）
- Produces:
  - 认证卡片图片：`derivedUrl` 非空 → `variant:'derived'` + `fallbackToOriginal: true`；否则 original + `fallbackToOriginal: false`
  - 认证视频封面：`posterDerivedUrl` 非空则 `posterMediaId` + derived，否则 `posterMediaId` original
  - 无「优化中」角标（现网本无，禁止新增）
  - 详情 `MomentImage` / `VideoBlock`：`useMediaUri(media.id)` 单参（高清档 original）
  - 播放中的视频文件始终 original（视频本体无 derived）
  - AudioBar 不改（音频无 derived；缺省 original）

- [ ] **Step 1: 基线确认（无 RN 组件测试基建，见偏差 15）**

Run: `pnpm --filter @moment/app typecheck`

Expected: exit 0。本 Task 红灯载体是 Step 4 typecheck：若误把详情改成 derived、或 `cardImageVariant` 未 import 会红。

- [ ] **Step 2: MediaGrid 最小实现**

Modify `apps/app/src/components/MediaGrid.tsx`：

(a) import 追加：

```ts
import { cardImageVariant, posterCardVariant } from '../lib/media-variant';
```

(b) 把 `MediaImage` 整函数换成：

```ts
function MediaImage({ media, cellStyle }: { media: MomentMedia; cellStyle: object }) {
  const variant = cardImageVariant(media.derivedUrl);
  const uri = useMediaUri(media.id, {
    variant,
    fallbackToOriginal: variant === 'derived',
  });
  if (!uri) return <View style={cellStyle} />;
  return <Image source={{ uri }} style={cellStyle} resizeMode="cover" />;
}
```

(c) `VideoCell` 内 `useMediaUri(m.posterMediaId ?? undefined)` 换成：

```ts
  const pVariant = posterCardVariant(m.posterDerivedUrl);
  const uri = useMediaUri(m.posterMediaId ?? undefined, {
    variant: pVariant,
    fallbackToOriginal: pVariant === 'derived',
  });
```

(d) 图片分支调用从 `mediaId={m.id}` 换成 `media={m}`：

```ts
          <MediaImage key={m.id} media={m} cellStyle={styles.cell} />
```

- [ ] **Step 3: 详情页钉死 original**

Modify `apps/app/src/features/moment/index.tsx` — `MomentImage` / `VideoBlock` 的 hook 调用保持：

```ts
  const uri = useMediaUri(media.id);
```

在 `MomentImage` 函数体第一行 hook **之上**加注释（不要改调用）：

```ts
  // Lightbox 同构（spec §7.3）：详情大图/视频永远 original，即使行上 derivedUrl 非空
  const uri = useMediaUri(media.id);
```

`VideoBlock` 内现网是：

```ts
  const uri = useMediaUri(media.id);
```

改成：

```ts
  // Lightbox 同构（spec §7.3）：详情大图/视频永远 original，即使行上 derivedUrl 非空
  const uri = useMediaUri(media.id);
```

禁止给 `MomentImage` / `VideoBlock` 这两处传 `{ variant: 'derived' }`。

- [ ] **Step 4: 门禁**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app test`

Expected: 全绿。`MomentMedia.derivedUrl` 已由 P3 必填；若类型可选，真值判断仍然合法。`MediaImage` 参数从 `mediaId: string` 改为 `media: MomentMedia` 后，旧属性名 `mediaId=` 必须已删，否则 typecheck 红。

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/MediaGrid.tsx apps/app/src/features/moment/index.tsx
git commit -m "feat(app): use derived images on timeline cards and originals in detail"
```

---

### Task 3: `buildFeedQuery` / `buildChainMomentsQuery` + Service 把 `personId`/`place` 送进 GET

**Files:**
- Create: `apps/app/src/lib/timeline-query.ts`
- Test: `apps/app/src/lib/timeline-query.test.ts`
- Modify: `apps/app/src/features/feed/feed.service.ts`
- Modify: `apps/app/src/features/chain-home/chain-home.service.ts`

**Interfaces:**
- Consumes: P8 `client.getFeed(query?: FeedQuery)`（含 `personId`/`place`）；P8 `client.listChainMoments(chainId, query?: { cursor?, limit?, before?, personId?, place?, happenedFrom?, happenedTo? })`；现网 `FeedService` 字段 `chainId`/`tagId`/`order`；现网 `ChainHomeService.listChainMoments(this.chainId, { cursor, limit: 20 })`
- Produces:
  - `TIMELINE_PAGE_SIZE = 20`
  - `buildFeedQuery(args: { cursor?: string; chainId?: string; tagId?: string; order: 'happened_at' | 'created_at'; personId?: string; place?: string; limit: number })` — 产出 getFeed 入参：`chainIds: chainId ? [chainId] : undefined`，带出 `personId`/`place`，**永不**带 `personName` / `happenedFrom` / `happenedTo` / `before`
  - `buildChainMomentsQuery(args: { cursor?: string; personId?: string; place?: string; limit: number })` — 产出 listChainMoments 第二参；**永不**带 `personName` / `happenedFrom` / `happenedTo` / `before` / `order` / `source`（app 无日历锚，P8 的 `before` 键不得从链页 GET 发出）
  - `FeedService.personId?: string` / `personName?: string` / `place?: string`
  - `FeedService.filtered: boolean` — `tagId || chainId || order==='created_at' || personId || place`
  - `FeedService.togglePersonFilter({ id, name }): void` — 同一 id 再点清除；否则单选写入 personId+personName；然后 `void loadFirst()`
  - `FeedService.togglePlaceFilter(place: string): void` — 同一 place 再点清除
  - `FeedService.clearPersonFilter(): void` / `clearPlaceFilter(): void`
  - `setChainFilter` 在写 `chainId` 时把 `personId`/`personName` 置 `undefined`（偏差 16）；`place` 保留
  - `ChainHomeService` 同名字段与同名 toggle/clear；`filtered` **只**看 `personId`/`place`（不要把恒在的本链算进 filtered）
  - `ChainHomeService.hydrate` 换链时复位 person/place
  - `loadFirst`/`loadMore` GET 走上述 builder；本 Task **不**加搜索字段
  - month-index / `getMonthIndex`：**不**调用、不加 personId/place

- [ ] **Step 1: 写失败测试**

Create `apps/app/src/lib/timeline-query.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery, buildFeedQuery } from './timeline-query';

describe('TIMELINE_PAGE_SIZE', () => {
  it('锁 20（偏差 7：对齐现网 feed/链列表，不是 web 的 50）', () => {
    expect(TIMELINE_PAGE_SIZE).toBe(20);
  });
});

describe('buildFeedQuery（spec §7.1 RailFilter.personId/place → getFeed）', () => {
  it('带出 personId/place，不带 personName/happenedFrom/happenedTo/before', () => {
    const q = buildFeedQuery({
      cursor: 'cur',
      chainId: 'c-1',
      tagId: 't-1',
      order: 'happened_at',
      personId: 'p-1',
      place: '朝阳公园',
      limit: TIMELINE_PAGE_SIZE,
    });
    expect(q).toEqual({
      cursor: 'cur',
      chainIds: ['c-1'],
      tagId: 't-1',
      order: 'happened_at',
      personId: 'p-1',
      place: '朝阳公园',
      limit: 20,
    });
    expect(q).not.toHaveProperty('personName');
    expect(q).not.toHaveProperty('happenedFrom');
    expect(q).not.toHaveProperty('happenedTo');
    expect(q).not.toHaveProperty('before');
  });

  it('无 chainId 时 chainIds 为 undefined（全部链）', () => {
    const q = buildFeedQuery({ order: 'created_at', limit: 20 });
    expect(q.chainIds).toBeUndefined();
    expect(q.order).toBe('created_at');
    expect(q.personId).toBeUndefined();
    expect(q.place).toBeUndefined();
  });
});

describe('buildChainMomentsQuery（spec §6.1 app 链页 listChainMoments）', () => {
  it('带出 personId/place，不带 personName/happenedFrom/happenedTo/before/order/source', () => {
    const q = buildChainMomentsQuery({
      cursor: 'c2',
      personId: 'p-1',
      place: '朝阳公园',
      limit: TIMELINE_PAGE_SIZE,
    });
    expect(q).toEqual({
      cursor: 'c2',
      personId: 'p-1',
      place: '朝阳公园',
      limit: 20,
    });
    expect(q).not.toHaveProperty('personName');
    expect(q).not.toHaveProperty('happenedFrom');
    expect(q).not.toHaveProperty('happenedTo');
    expect(q).not.toHaveProperty('before');
    expect(q).not.toHaveProperty('order');
    expect(q).not.toHaveProperty('source');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/app test -- src/lib/timeline-query.test.ts`

Expected: FAIL，`Cannot find module './timeline-query'`。

- [ ] **Step 3: 最小实现**

Create `apps/app/src/lib/timeline-query.ts`：

```ts
/** app 时间线页大小（现网 feed / 链列表均为 20；搜索同页大小，偏差 7）。 */
export const TIMELINE_PAGE_SIZE = 20;

export function buildFeedQuery(args: {
  cursor?: string;
  chainId?: string;
  tagId?: string;
  order: 'happened_at' | 'created_at';
  personId?: string;
  place?: string;
  limit: number;
}): {
  cursor?: string;
  chainIds?: string[];
  tagId?: string;
  order: 'happened_at' | 'created_at';
  personId?: string;
  place?: string;
  limit: number;
} {
  return {
    cursor: args.cursor,
    chainIds: args.chainId ? [args.chainId] : undefined,
    tagId: args.tagId,
    order: args.order,
    personId: args.personId,
    place: args.place,
    limit: args.limit,
  };
}

export function buildChainMomentsQuery(args: {
  cursor?: string;
  personId?: string;
  place?: string;
  limit: number;
}): {
  cursor?: string;
  personId?: string;
  place?: string;
  limit: number;
} {
  return {
    cursor: args.cursor,
    personId: args.personId,
    place: args.place,
    limit: args.limit,
  };
}
```

Modify `apps/app/src/features/feed/feed.service.ts`：

(a) 删掉 `const PAGE_SIZE = 20;`，改为：

```ts
import { TIMELINE_PAGE_SIZE, buildFeedQuery } from '../../lib/timeline-query';
```

(b) 字段 `tags: TagResponse[] = [];` 之后追加：

```ts
  /** RailFilter.personId 投影（spec §7.1）；单选。personName 仅清除 chip 展示，不进 HTTP */
  personId: string | undefined = undefined;
  personName: string | undefined = undefined;
  /** RailFilter.place 投影；整串等值 */
  place: string | undefined = undefined;
```

(c) `get hasMore` **之前**追加：

```ts
  get filtered(): boolean {
    return Boolean(
      this.chainId || this.tagId || this.order === 'created_at' || this.personId || this.place,
    );
  }
```

(d) `setChainFilter` 在 `this.tagId = undefined;` 之后追加：

```ts
    this.personId = undefined;
    this.personName = undefined;
```

（`place` 不要清。）

(e) `toggleOrder` 方法块之后、`get chainList` 之前追加：

```ts
  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.personId === person.id) {
      this.personId = undefined;
      this.personName = undefined;
    } else {
      this.personId = person.id;
      this.personName = person.name;
    }
    void this.loadFirst().catch(() => undefined);
  }

  togglePlaceFilter(place: string): void {
    this.place = this.place === place ? undefined : place;
    void this.loadFirst().catch(() => undefined);
  }

  clearPersonFilter(): void {
    this.personId = undefined;
    this.personName = undefined;
    void this.loadFirst().catch(() => undefined);
  }

  clearPlaceFilter(): void {
    this.place = undefined;
    void this.loadFirst().catch(() => undefined);
  }
```

(f) `loadFirst` 里 `client.getFeed({...})` 整段换成：

```ts
    const page = await client.getFeed(
      buildFeedQuery({
        cursor: undefined,
        chainId: this.chainId,
        tagId: this.tagId,
        order: this.order,
        personId: this.personId,
        place: this.place,
        limit: TIMELINE_PAGE_SIZE,
      }),
    );
```

(g) `loadMore` 里 `client.getFeed({...})` 整段换成：

```ts
      const page = await client.getFeed(
        buildFeedQuery({
          cursor: this.nextCursor,
          chainId: this.chainId,
          tagId: this.tagId,
          order: this.order,
          personId: this.personId,
          place: this.place,
          limit: TIMELINE_PAGE_SIZE,
        }),
      );
```

Modify `apps/app/src/features/chain-home/chain-home.service.ts`：

(a) import 追加：

```ts
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery } from '../../lib/timeline-query';
```

(b) 字段 `activeView = 'timeline';` 之后追加：

```ts
  personId: string | undefined = undefined;
  personName: string | undefined = undefined;
  place: string | undefined = undefined;
```

(c) `hydrate` 在 `this.activeView = 'timeline';` 之后追加：

```ts
    this.personId = undefined;
    this.personName = undefined;
    this.place = undefined;
```

(d) `get canCompose` 之后追加：

```ts
  get filtered(): boolean {
    return Boolean(this.personId || this.place);
  }
```

(e) `loadFirst` 的 `listChainMoments` 换成：

```ts
    const page = await client.listChainMoments(
      this.chainId,
      buildChainMomentsQuery({
        cursor: undefined,
        personId: this.personId,
        place: this.place,
        limit: TIMELINE_PAGE_SIZE,
      }),
    );
```

(f) `loadMore` 的 `listChainMoments` 换成：

```ts
      const page = await client.listChainMoments(
        this.chainId,
        buildChainMomentsQuery({
          cursor: this.nextCursor,
          personId: this.personId,
          place: this.place,
          limit: TIMELINE_PAGE_SIZE,
        }),
      );
```

(g) `loadTags` **之前**追加（与 feed 同形，必须走 loadFirst，从而带上 personId/place）：

```ts
  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.personId === person.id) {
      this.personId = undefined;
      this.personName = undefined;
    } else {
      this.personId = person.id;
      this.personName = person.name;
    }
    void this.loadFirst().catch(() => undefined);
  }

  togglePlaceFilter(place: string): void {
    this.place = this.place === place ? undefined : place;
    void this.loadFirst().catch(() => undefined);
  }

  clearPersonFilter(): void {
    this.personId = undefined;
    this.personName = undefined;
    void this.loadFirst().catch(() => undefined);
  }

  clearPlaceFilter(): void {
    this.place = undefined;
    void this.loadFirst().catch(() => undefined);
  }
```

- [ ] **Step 4: 运行确认通过**

Run:

```
pnpm --filter @moment/app test -- src/lib/timeline-query.test.ts
pnpm --filter @moment/app typecheck
pnpm --filter @moment/app lint
```

Expected: 测试 PASS；typecheck 绿（`getFeed` / `listChainMoments` 已识别 `personId`/`place`——若红，先 `pnpm --filter @moment/api-client build`，禁止在 app 补类型）。

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/timeline-query.ts apps/app/src/lib/timeline-query.test.ts apps/app/src/features/feed/feed.service.ts apps/app/src/features/chain-home/chain-home.service.ts
git commit -m "feat(app): pass personId and place through feed and chain moment lists"
```

---

### Task 4: 人物/地点 chip 可点 + 列表顶清除 chip（详情/往年今日不可点）

**Files:**
- Modify: `apps/app/src/components/MomentCard.tsx`
- Create: `apps/app/src/components/FilterChips.tsx`
- Modify: `apps/app/src/features/feed/index.tsx`
- Modify: `apps/app/src/features/chain-home/index.tsx`

**Interfaces:**
- Consumes: Task 3 `togglePersonFilter` / `togglePlaceFilter` / `clearPersonFilter` / `clearPlaceFilter` / `personName`；现网 MomentCard 只读 chip 视觉（`hoverSoft` + `fontSupport`）；现网 feed 本地 `Chip` **不**复用、不重构
- Produces:
  - `MomentCard` 可选 `onPersonFilter?: (person: { id: string; name: string }) => void`、`onPlaceFilter?: (place: string) => void`
  - 传入回调 → 内层 `Pressable` + `accessibilityRole="button"` + `accessibilityLabel={`筛选 ${name}`}` / `` `筛选地点 ${name}` `` + AI 角标保留 + 可交互 `minHeight: touchMin`；不传 → 现网 `View`/`Text`（详情不走 MomentCard；往年今日不传回调）
  - 地点 `place?.name` 才可点（null 名仍不渲染，P6 偏差 9）；可点地点用 `placePressable`（`minHeight: touchMin`），**禁止**只靠 `hitSlop` space2（8+8+字号 < 44）
  - `<FilterChips personId personName place onClearPerson onClearPlace />`：无人/地不渲染；文案「{personName} ×」「📍 {place} ×」；命中区 ≥ touchMin
  - feed 在标签 chip 行之后、FlashList 之前插 FilterChips；`MomentCard` 传 toggle
  - chain-home **仅** `segment === 'timeline'` 插 FilterChips 并传 toggle；timeline 段必须是 `timelinePane`（flex:1）包 FilterChips + `FlashList style={timelineList}`（也是 flex:1），否则 FlashList 2 多子树高度塌 0
  - 正文 tag 字 **不**新绑点击

- [ ] **Step 1: 基线确认**

Run: `pnpm --filter @moment/app typecheck`

Expected: exit 0。

- [ ] **Step 2: FilterChips**

Create `apps/app/src/components/FilterChips.tsx`：

```tsx
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 列表顶清除 chip（spec §7.1）。app 无 before 日历，不渲染「回到今天」（偏差 13）。 */
export function FilterChips({
  personId,
  personName,
  place,
  onClearPerson,
  onClearPlace,
}: {
  personId?: string;
  personName?: string;
  place?: string;
  onClearPerson: () => void;
  onClearPlace: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const hasPerson = Boolean(personId);
  const hasPlace = Boolean(place);
  if (!hasPerson && !hasPlace) return null;
  return (
    <View style={styles.row}>
      {hasPerson ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`清除人物筛选 ${personName ?? '人物'}`}
          onPress={onClearPerson}
          style={styles.chip}
        >
          <Text style={styles.chipText}>{personName ?? '人物'} ×</Text>
        </Pressable>
      ) : null}
      {hasPlace ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`清除地点筛选 ${place}`}
          onPress={onClearPlace}
          style={styles.chip}
        >
          <Text style={styles.chipText}>📍 {place} ×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.space2,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
    },
    chip: {
      paddingHorizontal: t.space3,
      minHeight: t.touchMin,
      justifyContent: 'center',
      borderRadius: t.radiusMd,
      backgroundColor: t.hoverSoft,
    },
    chipText: { fontSize: t.fontSupport, color: t.ink },
  });
```

- [ ] **Step 3: MomentCard 可选回调**

Modify `apps/app/src/components/MomentCard.tsx`：

(a) props 增加（`ageLabel` 之后）：

```ts
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
```

函数签名同步加上 `onPersonFilter, onPlaceFilter,`。

(b) 把人物/地点展示块（P6 那两段，含「只读展示，不可点击」注释）整段替换为：

```tsx
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
            <Text style={styles.tplLine}>📍 {moment.place.name}</Text>
          </Pressable>
        ) : (
          <Text style={styles.tplLine}>📍 {moment.place.name}</Text>
        )
      ) : null}
```

(c) `createStyles` 在 `personChip: ...` 之后追加（只读 chip 样式不改，可点 chip / 地点才 `touchMin`）。**禁止**只用 `hitSlop={{ top: t.space2, bottom: t.space2 }}`：`space2` 是 8，配合 `fontSupport` 13 的地点行 ≈ 29–36pt，低于 `touchMin` 44。

```ts
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
```

- [ ] **Step 4: feed / chain-home 接线**

Modify `apps/app/src/features/feed/index.tsx`：

(a) import 追加：

```ts
import { FilterChips } from '../../components/FilterChips';
```

(b) 标签 chip 行（`service.chainId != null && service.tags.length > 0 ? (...) : null`）之后、`errorBanner` 之前插入：

```tsx
      <FilterChips
        personId={service.personId}
        personName={service.personName}
        place={service.place}
        onClearPerson={() => service.clearPersonFilter()}
        onClearPlace={() => service.clearPlaceFilter()}
      />
```

(c) `ListEmptyComponent` 换成：

```tsx
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {service.personId || service.place || service.tagId
                ? '没有符合条件的时刻'
                : '还没有时刻，发布第一条吧'}
            </Text>
          </View>
        }
```

（搜索空态在 Task 5 再插 `searching` 分支，本 Task 不要写 `service.searching`——字段还不存在，typecheck 会红。）

(d) `<MomentCard` 在 `onLongPress={...}` 之后追加：

```tsx
            onPersonFilter={(p) => service.togglePersonFilter(p)}
            onPlaceFilter={(place) => service.togglePlaceFilter(place)}
```

Modify `apps/app/src/features/chain-home/index.tsx`：

(a) import 追加：

```ts
import { FilterChips } from '../../components/FilterChips';
```

(b) 现网 `{segment === 'timeline' ? ( <FlashList ... /> ) : null}` 只能有一个根节点。把**整段**换成下面这块（写全，不要只改开标签）：FilterChips + FlashList 必须包在 `flex:1` 容器里，且 **FlashList 自身也要 `style={styles.timelineList}`（`flex:1`）**。只给外层 View `flex:1`、FlashList 不设 flex 时，FlashList 2 在多子树列里高度会塌成 0（筛选项看得见、卡片没有）。

把现网：

```tsx
      {segment === 'timeline' ? (
        <FlashList
          data={service.moments}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          onEndReachedThreshold={0.4}
          onEndReached={() => void service.loadMore().catch(() => undefined)}
          renderItem={({ item }: { item: MomentResponse }) => (
            <MomentCard
              moment={item}
              onPress={() => router.push(`/moments/${item.id}`)}
              onLongPress={
                // spec §4.2：长按编辑/删除仅作者本人的卡片生效
                myId === item.author.id
                  ? () =>
                      showMomentActions(item, () =>
                        router.push({ pathname: '/compose', params: { momentId: item.id } }),
                      )
                  : undefined
              }
              templateManifest={service.chain?.templateManifest ?? null}
              ageLabel={(() => {
                const birthdate = service.chain?.payload?.birthdate;
                return typeof birthdate === 'string' ? babyAgeLabel(birthdate, item.happenedAt, item.happenedTzOffset) : undefined;
              })()}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>还没有时刻</Text>}
        />
      ) : null}
```

整段换成（`onPersonFilter` / `onPlaceFilter` 已含，Step 4(c) 不要再插一次；空态已含 person/place 分流，Step 4(d) 不要再改）：

```tsx
      {segment === 'timeline' ? (
        <View style={styles.timelinePane}>
          <FilterChips
            personId={service.personId}
            personName={service.personName}
            place={service.place}
            onClearPerson={() => service.clearPersonFilter()}
            onClearPlace={() => service.clearPlaceFilter()}
          />
          <FlashList
            data={service.moments}
            keyExtractor={(m) => m.id}
            style={styles.timelineList}
            contentContainerStyle={styles.list}
            onEndReachedThreshold={0.4}
            onEndReached={() => void service.loadMore().catch(() => undefined)}
            renderItem={({ item }: { item: MomentResponse }) => (
              <MomentCard
                moment={item}
                onPress={() => router.push(`/moments/${item.id}`)}
                onLongPress={
                  // spec §4.2：长按编辑/删除仅作者本人的卡片生效
                  myId === item.author.id
                    ? () =>
                        showMomentActions(item, () =>
                          router.push({ pathname: '/compose', params: { momentId: item.id } }),
                        )
                    : undefined
                }
                templateManifest={service.chain?.templateManifest ?? null}
                ageLabel={(() => {
                  const birthdate = service.chain?.payload?.birthdate;
                  return typeof birthdate === 'string' ? babyAgeLabel(birthdate, item.happenedAt, item.happenedTzOffset) : undefined;
                })()}
                onPersonFilter={(p) => service.togglePersonFilter(p)}
                onPlaceFilter={(place) => service.togglePlaceFilter(place)}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {service.personId || service.place ? '没有符合条件的时刻' : '还没有时刻'}
              </Text>
            }
          />
        </View>
      ) : null}
```

在 `createStyles` 增加：

```ts
    timelinePane: { flex: 1 },
    timelineList: { flex: 1 },
```

（Step 4(b) 的整段替换已含 MomentCard 回调与空态分流，不要再改第二遍。）

- [ ] **Step 5: 门禁**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app test`

Expected: 全绿。`features/moment/index.tsx` 与 `features/memories/index.tsx` **没有**传 onPersonFilter（详情/往年今日仍只读）。lint:tokens 零命中。

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/MomentCard.tsx apps/app/src/components/FilterChips.tsx apps/app/src/features/feed/index.tsx apps/app/src/features/chain-home/index.tsx
git commit -m "feat(app): click person and place chips to filter the timeline"
```

---

### Task 5: 主列 `Field` 搜索 → `POST /api/search`；可关闭 parsed 摘要；不带 `before`

**Files:**
- Create: `apps/app/src/lib/search-summary.ts`
- Test: `apps/app/src/lib/search-summary.test.ts`
- Modify: `apps/app/src/lib/timeline-query.ts`（追加 `buildSearchInput`）
- Modify: `apps/app/src/lib/timeline-query.test.ts`（追加搜索 body 用例）
- Create: `apps/app/src/components/TimelineSearchField.tsx`
- Modify: `apps/app/src/features/feed/feed.service.ts`
- Modify: `apps/app/src/features/chain-home/chain-home.service.ts`
- Modify: `apps/app/src/features/feed/index.tsx`
- Modify: `apps/app/src/features/chain-home/index.tsx`

**Interfaces:**
- Consumes: P8 `client.searchMoments(input: SearchInput): Promise<SearchResponse>`；P1 `SearchParsed` / `SearchInput` / `INTENT_MAX_QUERY_CHARS`；Task 3 `personId`/`tagId`/`place`/`TIMELINE_PAGE_SIZE`；既有 `Field`；既有 `humanError`（`RATE_LIMITED`）；既有 `ErrorText` / `Button`
- Produces:
  - `formatSearchParsed(parsed: SearchParsed): string` — 文案与 P8 逐字相同
  - `buildSearchInput(args)` — `SearchInput`；对象**不出现** `before`/`order`/`source`/`parsed`
  - `<TimelineSearchField onSubmit onClear />` — **不是** SearchBar；内部只有 `Field` + `returnKeyType="search"`
  - `FeedService` / `ChainHomeService`：`searching: boolean`、`searchQ: string`、`searchParsed: SearchParsed | null`、`searchError: unknown`、`submitSearch(q: string): Promise<void>`、`exitSearch(): Promise<void>`
  - `loadFirst`/`loadMore` 在 `searching` 时走 `searchMoments`：`q`、`tzOffset: new Date().getTimezoneOffset()`、`limit: TIMELINE_PAGE_SIZE`、`cursor?`、当前 `personId`/`place`；feed 另带 `tagId` 与 `chainIds: chainId ? [chainId] : undefined`；chain-home **恒** `chainIds: [this.chainId]` 且不传 `tagId`
  - 搜索失败写入 `searchError`，**不**覆盖已有 `moments`，不 `Alert` / Toast
  - 关闭摘要 / 清空搜索框 → `exitSearch` → 再 GET
  - 搜索空态文案「没有找到相关时刻」+ `Button quiet`「退出搜索」，且排在 filtered 空态之前
  - `searchError` 必须包在 `styles.searchBanner`（水平 `space3`、垂直 `space2`）里再放 `ErrorText`；禁止裸 `ErrorText` 贴屏边
  - 链主页仅 timeline 段渲染搜索框；往年今日 / 详情不加；**保留** T4 的 `timelineList: { flex: 1 }`

- [ ] **Step 1: 写失败测试**

Create `apps/app/src/lib/search-summary.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import type { SearchParsed } from '@moment/dto';
import { formatSearchParsed } from './search-summary';

describe('formatSearchParsed', () => {
  it('拼接人物、地点、墙钟日、剩余 text', () => {
    const parsed: SearchParsed = {
      personNames: ['外婆'],
      place: '朝阳公园',
      time: { kind: 'wall_date', year: 2025, month: 8, day: 29 },
      text: '野餐',
    };
    expect(formatSearchParsed(parsed)).toBe('找到：外婆 · 朝阳公园 · 2025年8月29日 · 野餐');
  });

  it('range 用 from/to 的日期部分', () => {
    const parsed: SearchParsed = {
      personNames: [],
      place: null,
      time: { kind: 'range', from: '2025-06-01T00:00:00.000Z', to: '2025-08-31T23:59:59.999Z' },
      text: '',
    };
    expect(formatSearchParsed(parsed)).toBe('找到：2025-06-01 – 2025-08-31');
  });

  it('降级 parsed（仅 text=q）不额外提示模型失败', () => {
    const parsed: SearchParsed = { personNames: [], place: null, time: null, text: '去年今天和外婆' };
    expect(formatSearchParsed(parsed)).toBe('找到：去年今天和外婆');
  });

  it('全空 →「搜索结果」', () => {
    const parsed: SearchParsed = { personNames: [], place: null, time: null, text: '' };
    expect(formatSearchParsed(parsed)).toBe('搜索结果');
  });
});
```

Modify `apps/app/src/lib/timeline-query.test.ts` — 文件末尾追加（并在顶部 import 增加 `buildSearchInput`）：

顶部 import 换成：

```ts
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery, buildFeedQuery, buildSearchInput } from './timeline-query';
```

文件末尾追加：

```ts
describe('buildSearchInput（spec §7.2：不带 before/order/source）', () => {
  it('POST body 含 q/tzOffset/chainIds/personId/tagId/place/limit/cursor，不含 before/order/source/parsed', () => {
    const body = buildSearchInput({
      q: '去年今天和外婆',
      tzOffset: -480,
      chainIds: ['c-1'],
      cursor: 's-cur',
      limit: TIMELINE_PAGE_SIZE,
      personId: 'p-1',
      tagId: 't-1',
      place: '朝阳公园',
    });
    expect(body).toEqual({
      q: '去年今天和外婆',
      tzOffset: -480,
      chainIds: ['c-1'],
      cursor: 's-cur',
      limit: 20,
      personId: 'p-1',
      tagId: 't-1',
      place: '朝阳公园',
    });
    expect(body).not.toHaveProperty('before');
    expect(body).not.toHaveProperty('order');
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('parsed');
  });

  it('可选键缺省时不出现在对象上', () => {
    const body = buildSearchInput({ q: '外婆', tzOffset: -480, limit: 20 });
    expect(body).toEqual({ q: '外婆', tzOffset: -480, limit: 20 });
    expect(body).not.toHaveProperty('chainIds');
    expect(body).not.toHaveProperty('personId');
    expect(body).not.toHaveProperty('tagId');
    expect(body).not.toHaveProperty('place');
    expect(body).not.toHaveProperty('cursor');
    expect(body).not.toHaveProperty('before');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run:

```
pnpm --filter @moment/app test -- src/lib/search-summary.test.ts
pnpm --filter @moment/app test -- src/lib/timeline-query.test.ts
```

Expected: 第一条 FAIL（`./search-summary` 不存在）。第二条 FAIL（`buildSearchInput` is not a function / 未导出）。`buildFeedQuery` 旧用例必须仍绿。

- [ ] **Step 3: 纯函数 + Search Field + Service + 页面**

Create `apps/app/src/lib/search-summary.ts`：

```ts
import type { SearchParsed } from '@moment/dto';

export function formatSearchParsed(parsed: SearchParsed): string {
  const bits: string[] = [];
  if (parsed.personNames.length > 0) bits.push(parsed.personNames.join('、'));
  if (parsed.place) bits.push(parsed.place);
  if (parsed.time?.kind === 'wall_date') {
    bits.push(`${parsed.time.year}年${parsed.time.month}月${parsed.time.day}日`);
  } else if (parsed.time?.kind === 'range') {
    bits.push(`${parsed.time.from.slice(0, 10)} – ${parsed.time.to.slice(0, 10)}`);
  }
  if (parsed.text) bits.push(parsed.text);
  return bits.length > 0 ? `找到：${bits.join(' · ')}` : '搜索结果';
}
```

Modify `apps/app/src/lib/timeline-query.ts`：

(a) 文件最顶部增加：

```ts
import type { SearchInput } from '@moment/dto';
```

(b) 在 `buildChainMomentsQuery` 函数结束之后追加：

```ts
export function buildSearchInput(args: {
  q: string;
  tzOffset: number;
  chainIds?: string[];
  cursor?: string;
  limit: number;
  personId?: string;
  tagId?: string;
  place?: string;
}): SearchInput {
  return {
    q: args.q,
    tzOffset: args.tzOffset,
    limit: args.limit,
    ...(args.chainIds ? { chainIds: args.chainIds } : {}),
    ...(args.cursor ? { cursor: args.cursor } : {}),
    ...(args.personId ? { personId: args.personId } : {}),
    ...(args.tagId ? { tagId: args.tagId } : {}),
    ...(args.place ? { place: args.place } : {}),
  };
}
```

Create `apps/app/src/components/TimelineSearchField.tsx`：

```tsx
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { INTENT_MAX_QUERY_CHARS } from '@moment/dto';
import { Field } from './Field';
import type { Theme } from '../theme/theme';
import { useTheme } from '../theme/use-theme';

/** 时间线搜索：复用 Field + returnKeyType=search，不是新的 SearchBar。 */
export function TimelineSearchField({
  onSubmit,
  onClear,
}: {
  onSubmit: (q: string) => void;
  onClear: () => void;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const [q, setQ] = useState('');

  function submit(): void {
    const trimmed = q.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <View style={styles.wrap}>
      <Field
        label="搜索时刻"
        accessibilityLabel="搜索时刻"
        value={q}
        onChangeText={(next) => {
          setQ(next);
          if (next === '') onClear();
        }}
        placeholder="搜索时刻，例如 去年今天和外婆"
        returnKeyType="search"
        onSubmitEditing={submit}
        clearButtonMode="while-editing"
        autoCorrect={false}
        enablesReturnKeyAutomatically
      />
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: t.space3, paddingTop: t.space2, paddingBottom: t.space2, gap: t.space2 },
  });
```

Modify `feed.service.ts`：

(a) import 增加 `type SearchParsed`（`@moment/dto` 现有 import 行改成含 `SearchParsed`）：

```ts
import type { MomentResponse, SearchParsed, TagResponse } from '@moment/dto';
```

```ts
import { TIMELINE_PAGE_SIZE, buildFeedQuery, buildSearchInput } from '../../lib/timeline-query';
```

(b) 字段 `place` 之后追加：

```ts
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
```

(c) `clearPlaceFilter` 之后追加：

```ts
  async submitSearch(q: string): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed) return;
    this.searchQ = trimmed;
    this.searching = true;
    this.searchParsed = null;
    this.searchError = null;
    await this.loadFirst();
  }

  async exitSearch(): Promise<void> {
    this.searching = false;
    this.searchQ = '';
    this.searchParsed = null;
    this.searchError = null;
    await this.loadFirst();
  }
```

(d) **整段替换** `loadFirst`：

```ts
  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    try {
      if (this.searching) {
        const page = await client.searchMoments(
          buildSearchInput({
            q: this.searchQ,
            tzOffset: new Date().getTimezoneOffset(),
            chainIds: this.chainId ? [this.chainId] : undefined,
            limit: TIMELINE_PAGE_SIZE,
            personId: this.personId,
            tagId: this.tagId,
            place: this.place,
          }),
        );
        if (gen !== this.gen) return;
        this.moments = page.moments;
        this.nextCursor = page.nextCursor ?? null;
        this.searchParsed = page.parsed;
        this.searchError = null;
        return;
      }
      const page = await client.getFeed(
        buildFeedQuery({
          cursor: undefined,
          chainId: this.chainId,
          tagId: this.tagId,
          order: this.order,
          personId: this.personId,
          place: this.place,
          limit: TIMELINE_PAGE_SIZE,
        }),
      );
      if (gen !== this.gen) return;
      this.moments = page.moments;
      this.nextCursor = page.nextCursor ?? null;
    } catch (err) {
      if (gen !== this.gen) return;
      if (this.searching) this.searchError = err;
      else throw err;
    }
  }
```

非搜索路径的 `throw` 保留给 `$model.loadFirst.error`（现网「加载失败，下拉重试」）。搜索路径吞进 `searchError`。

(e) **整段替换** `loadMore` 的 try 体内取 page 那一段（保留 `loadingMore` 守卫）：

```ts
  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = this.searching
        ? await client.searchMoments(
            buildSearchInput({
              q: this.searchQ,
              tzOffset: new Date().getTimezoneOffset(),
              chainIds: this.chainId ? [this.chainId] : undefined,
              cursor: this.nextCursor,
              limit: TIMELINE_PAGE_SIZE,
              personId: this.personId,
              tagId: this.tagId,
              place: this.place,
            }),
          )
        : await client.getFeed(
            buildFeedQuery({
              cursor: this.nextCursor,
              chainId: this.chainId,
              tagId: this.tagId,
              order: this.order,
              personId: this.personId,
              place: this.place,
              limit: TIMELINE_PAGE_SIZE,
            }),
          );
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
      // 搜索翻页不覆盖首页 searchParsed（后一页 parsed 可能漂移）
    } finally {
      this.loadingMore = false;
    }
  }
```

Modify `chain-home.service.ts`：

(a) import：

```ts
import type { AggregateResponse, ChainDetailDto, MomentResponse, SearchParsed, TagResponse } from '@moment/dto';
```

```ts
import { TIMELINE_PAGE_SIZE, buildChainMomentsQuery, buildSearchInput } from '../../lib/timeline-query';
```

(b) 字段 `place` 之后追加：

```ts
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
```

(c) `hydrate` 换链复位（在 person/place 复位之后）追加：

```ts
    this.searching = false;
    this.searchQ = '';
    this.searchParsed = null;
    this.searchError = null;
```

(d) `clearPlaceFilter` 之后追加：

```ts
  async submitSearch(q: string): Promise<void> {
    const trimmed = q.trim();
    if (!trimmed) return;
    this.searchQ = trimmed;
    this.searching = true;
    this.searchParsed = null;
    this.searchError = null;
    await this.loadFirst();
  }

  async exitSearch(): Promise<void> {
    this.searching = false;
    this.searchQ = '';
    this.searchParsed = null;
    this.searchError = null;
    await this.loadFirst();
  }
```

(e) `loadFirst` **整段替换**为（注意 `if (!this.chainId) return` 仍要保留在 gen++ 之前——现网 `hydrate` 会先设 chainId，但防御空 id）：

```ts
  async loadFirst(): Promise<void> {
    if (!this.chainId) return;
    const gen = ++this.gen;
    try {
      if (this.searching) {
        const page = await client.searchMoments(
          buildSearchInput({
            q: this.searchQ,
            tzOffset: new Date().getTimezoneOffset(),
            chainIds: [this.chainId],
            limit: TIMELINE_PAGE_SIZE,
            personId: this.personId,
            place: this.place,
          }),
        );
        if (gen !== this.gen) return;
        this.moments = page.moments;
        this.nextCursor = page.nextCursor ?? null;
        this.searchParsed = page.parsed;
        this.searchError = null;
        return;
      }
      const page = await client.listChainMoments(
        this.chainId,
        buildChainMomentsQuery({
          cursor: undefined,
          personId: this.personId,
          place: this.place,
          limit: TIMELINE_PAGE_SIZE,
        }),
      );
      if (gen !== this.gen) return;
      this.moments = page.moments;
      this.nextCursor = page.nextCursor ?? null;
    } catch (err) {
      if (gen !== this.gen) return;
      if (this.searching) this.searchError = err;
      else throw err;
    }
  }
```

链页搜索 **不**传 `tagId`（Service 无该字段，偏差 21）。`chainIds` **恒** `[this.chainId]`。

(f) `loadMore` **整段替换**：

```ts
  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = this.searching
        ? await client.searchMoments(
            buildSearchInput({
              q: this.searchQ,
              tzOffset: new Date().getTimezoneOffset(),
              chainIds: [this.chainId],
              cursor: this.nextCursor,
              limit: TIMELINE_PAGE_SIZE,
              personId: this.personId,
              place: this.place,
            }),
          )
        : await client.listChainMoments(
            this.chainId,
            buildChainMomentsQuery({
              cursor: this.nextCursor,
              personId: this.personId,
              place: this.place,
              limit: TIMELINE_PAGE_SIZE,
            }),
          );
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }
```

Modify `apps/app/src/features/feed/index.tsx`：

(a) import 追加：

```ts
import { ErrorText } from '../../components/ErrorText';
import { Button } from '../../components/Button';
import { TimelineSearchField } from '../../components/TimelineSearchField';
import { formatSearchParsed } from '../../lib/search-summary';
import { humanError } from '../../lib/errors';
```

现网 `feed/index.tsx` 没有这五条 import，全部新增；不要重复已有的 `View`/`Text`/`MomentCard`/`FeedService`。

(b) `MemoriesEntryBar` **之后**、链 chip 的 `<View style={styles.filters}>` **之前**插入：

```tsx
      <TimelineSearchField
        onSubmit={(q) => void service.submitSearch(q)}
        onClear={() => {
          if (service.searching) void service.exitSearch();
        }}
      />
```

(c) `FilterChips` 之后、`errorBanner` 之前插入。**不要**裸插 `ErrorText`：它只是一条 danger `Text`，没有水平 padding，会贴屏幕左缘（现网 GET `errorBanner` 有 `padding: t.space2`；P8 用自带内边距的 Banner）。必须包 `searchBanner`。

```tsx
      {service.searchError ? (
        <View style={styles.searchBanner}>
          <ErrorText message={humanError(service.searchError)} />
        </View>
      ) : null}
      {service.searching && service.searchParsed && !service.searchError ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>{formatSearchParsed(service.searchParsed)}</Text>
          <Button variant="quiet" onPress={() => void service.exitSearch()}>
            关闭
          </Button>
        </View>
      ) : null}
```

同一区域：有 `searchError` 就不展示 parsed。

(d) `ListEmptyComponent` 的文案三元改成 `searching` 最先：

```tsx
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {service.searching
                ? '没有找到相关时刻'
                : service.personId || service.place || service.tagId
                  ? '没有符合条件的时刻'
                  : '还没有时刻，发布第一条吧'}
            </Text>
            {service.searching ? (
              <Button variant="quiet" onPress={() => void service.exitSearch()}>
                退出搜索
              </Button>
            ) : null}
          </View>
        }
```

(e) `createStyles` 追加：

```ts
    searchBanner: { paddingHorizontal: t.space3, paddingVertical: t.space2 },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
    },
    summaryText: { flex: 1, minWidth: 0, fontSize: t.fontSupport, color: t.muted },
```

`empty` 已是 `alignItems: 'center'`；退出搜索按钮会落在文案下。给 `empty` 加 `gap: t.space2`（现网 empty 无 gap；这是新空态需要的，允许改这一处）。

Modify `apps/app/src/features/chain-home/index.tsx`：

(a) import 区追加（`Button` / `humanError` / `View` / `Text` 已在文件里，不要重复）：

```tsx
import { ErrorText } from '../../components/ErrorText';
import { TimelineSearchField } from '../../components/TimelineSearchField';
import { formatSearchParsed } from '../../lib/search-summary';
```

(b) T4 已把 timeline 段包在 `<View style={styles.timelinePane}>` 里，FlashList 已有 `style={styles.timelineList}`。**不要**删掉 `timelineList`。在该 View 内、`<FilterChips` **之前**插入（`ErrorText` 同样必须包 `searchBanner`，理由同 feed）：

```tsx
          <TimelineSearchField
            onSubmit={(q) => void service.submitSearch(q)}
            onClear={() => {
              if (service.searching) void service.exitSearch();
            }}
          />
          {service.searchError ? (
            <View style={styles.searchBanner}>
              <ErrorText message={humanError(service.searchError)} />
            </View>
          ) : null}
          {service.searching && service.searchParsed && !service.searchError ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>{formatSearchParsed(service.searchParsed)}</Text>
              <Button variant="quiet" onPress={() => void service.exitSearch()}>
                关闭
              </Button>
            </View>
          ) : null}
```

(c) `ListEmptyComponent` 换成：

```tsx
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>
                {service.searching
                  ? '没有找到相关时刻'
                  : service.personId || service.place
                    ? '没有符合条件的时刻'
                    : '还没有时刻'}
              </Text>
              {service.searching ? (
                <Button variant="quiet" onPress={() => void service.exitSearch()}>
                  退出搜索
                </Button>
              ) : null}
            </View>
          }
```

(d) `createStyles` 追加（保留 T4 的 `timelinePane` / `timelineList`）：

```ts
    searchBanner: { paddingHorizontal: t.space3, paddingVertical: t.space2 },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space2,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
    },
    summaryText: { flex: 1, minWidth: 0, fontSize: t.fontSupport, color: t.muted },
```

以及：

```ts
    emptyWrap: { padding: t.space8, alignItems: 'center', gap: t.space2 },
```

现网 `empty: { color: t.muted, textAlign: 'center', padding: t.space8 }` 保留给 Text；外层 padding 改走 `emptyWrap`，把 `empty` 的 `padding: t.space8` **删掉**以免双倍空白（只在本 Task 这条样式上改）。

- [ ] **Step 4: 运行确认通过**

Run:

```
pnpm --filter @moment/app test -- src/lib/search-summary.test.ts
pnpm --filter @moment/app test -- src/lib/timeline-query.test.ts
pnpm --filter @moment/app test
pnpm --filter @moment/app typecheck
pnpm --filter @moment/app lint
```

Expected: 全绿。`client.searchMoments` 必须来自 `@moment/api-client` dist，禁止在 `lib/api.ts` 手写 fetch。

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/search-summary.ts apps/app/src/lib/search-summary.test.ts apps/app/src/lib/timeline-query.ts apps/app/src/lib/timeline-query.test.ts apps/app/src/components/TimelineSearchField.tsx apps/app/src/features/feed/feed.service.ts apps/app/src/features/feed/index.tsx apps/app/src/features/chain-home/chain-home.service.ts apps/app/src/features/chain-home/index.tsx
git commit -m "feat(app): search moments from the timeline Field"
```

---

### Task 6: 链设置 owner「处理中」分区（focus 时 10s 轮询，无重试按钮）

**Files:**
- Create: `apps/app/src/lib/job-labels.ts`
- Test: `apps/app/src/lib/job-labels.test.ts`
- Modify: `apps/app/src/features/chain-settings/chain-settings.service.ts`
- Create: `apps/app/src/features/chain-settings/jobs-section.tsx`
- Modify: `apps/app/src/features/chain-settings/index.tsx`

**Interfaces:**
- Consumes: P8 `client.listChainJobs(chainId: string, query?: { status?: string; limit?: number }): Promise<ChainJobListResponse>`；P1 `ChainJobDto`；既有 `isOwner` / `ErrorText` / `humanError` / `useTheme`
- Produces:
  - `JOBS_POLL_MS = 10000`
  - `jobTypeLabel(type: ChainJobDto['type']): string` — `moment.compress` →「压缩图」；`moment.embed` →「索引」
  - `jobStatusLabel(status: ChainJobDto['status']): string` — `pending` →「处理中」；`failed` →「失败」；`done` →「完成」
  - `ChainSettingsService.jobs: ChainJobDto[]`、`loadJobs(): Promise<void>` — `client.listChainJobs(this.chainId)` **无第二参**（服务端默认 pending,failed）
  - **不要**在 `loadChain` 里调用 `loadJobs`
  - `hydrate` 换链时 `jobs = []`
  - `<JobsSection />`：`useFocusEffect` 在焦点时 `loadJobs` + `setInterval(JOBS_POLL_MS)`，失焦/unmount `clearInterval`；非 owner 不渲染因此不打 API
  - 列：类型文案、`momentId` 前 8 位、状态、`{attempts} 次`、`lastError`、`toLocaleString(createdAt)`
  - 空态「没有处理中的任务」；v1 无重试按钮 / 无「再跑一次」文案

- [ ] **Step 1: 写失败测试**

Create `apps/app/src/lib/job-labels.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { JOBS_POLL_MS, jobStatusLabel, jobTypeLabel } from './job-labels';

describe('job labels（spec fused-retrieval §7.4）', () => {
  it('轮询间隔 10s', () => {
    expect(JOBS_POLL_MS).toBe(10_000);
  });

  it('类型与状态文案锁定', () => {
    expect(jobTypeLabel('moment.compress')).toBe('压缩图');
    expect(jobTypeLabel('moment.embed')).toBe('索引');
    expect(jobStatusLabel('pending')).toBe('处理中');
    expect(jobStatusLabel('failed')).toBe('失败');
    expect(jobStatusLabel('done')).toBe('完成');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/app test -- src/lib/job-labels.test.ts`

Expected: FAIL，`Cannot find module './job-labels'`。

- [ ] **Step 3: 最小实现**

Create `apps/app/src/lib/job-labels.ts`：

```ts
import type { ChainJobDto } from '@moment/dto';

export const JOBS_POLL_MS = 10_000;

export function jobTypeLabel(type: ChainJobDto['type']): string {
  if (type === 'moment.compress') return '压缩图';
  return '索引';
}

export function jobStatusLabel(status: ChainJobDto['status']): string {
  if (status === 'pending') return '处理中';
  if (status === 'failed') return '失败';
  return '完成';
}
```

Modify `apps/app/src/features/chain-settings/chain-settings.service.ts`：

(a) 顶部 dto import 换成含 `ChainJobDto`：

```ts
import type { ChainAppearanceColor, ChainDto, ChainIcon, ChainJobDto, ShareLinkDto } from '@moment/dto';
```

(b) 字段 `shareLinks: ShareLinkDto[] = [];` 之后追加：

```ts
  jobs: ChainJobDto[] = [];
```

(c) `hydrate` 在 `this.chainId = chainId;` 之后、`void this.loadChain()` 之前追加：

```ts
    this.jobs = [];
```

（现网 `if (this.chainId === chainId) return;` 仍在最前，同链不重置。）

(d) `loadShareLinks` 方法之后追加（**不要**从 `loadChain` 调用）：

```ts
  async loadJobs(): Promise<void> {
    if (!this.chainId) return;
    const res = await client.listChainJobs(this.chainId);
    this.jobs = res.jobs;
  }
```

Create `apps/app/src/features/chain-settings/jobs-section.tsx`：

```tsx
import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { observer, useService } from '@rabjs/react';
import { ErrorText } from '../../components/ErrorText';
import { humanError } from '../../lib/errors';
import { JOBS_POLL_MS, jobStatusLabel, jobTypeLabel } from '../../lib/job-labels';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { ChainSettingsService } from './chain-settings.service';

/** 链设置「处理中」（spec §7.4）：仅 owner 挂载；focus 时 load + 10s 轮询。v1 无重试。 */
export const JobsSection = observer(function JobsSection() {
  const service = useService(ChainSettingsService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useFocusEffect(
    useCallback(() => {
      void service.loadJobs().catch(() => undefined);
      const id = setInterval(() => {
        void service.loadJobs().catch(() => undefined);
      }, JOBS_POLL_MS);
      return () => clearInterval(id);
    }, [service, service.chainId]),
  );

  const error = service.$model.loadJobs.error;

  return (
    <View style={styles.block}>
      <Text style={styles.sectionTitle}>处理中</Text>
      <Text style={styles.hint}>压缩图和检索索引的后台任务，只有创建者看得到。</Text>
      {error ? <ErrorText message={humanError(error)} /> : null}
      {service.jobs.length === 0 ? (
        <Text style={styles.empty}>没有处理中的任务</Text>
      ) : (
        service.jobs.map((job) => (
          <View key={job.id} style={styles.row} accessibilityLabel={`${jobTypeLabel(job.type)} ${jobStatusLabel(job.status)}`}>
            <Text style={styles.type}>{jobTypeLabel(job.type)}</Text>
            <Text style={styles.muted}>{job.momentId.slice(0, 8)}</Text>
            <Text style={styles.status}>{jobStatusLabel(job.status)}</Text>
            <Text style={styles.muted}>{job.attempts} 次</Text>
            {job.lastError ? <Text style={styles.err}>{job.lastError}</Text> : null}
            <Text style={styles.time}>{new Date(job.createdAt).toLocaleString()}</Text>
          </View>
        ))
      )}
    </View>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    block: { gap: t.space2, marginTop: t.space3 },
    sectionTitle: { fontWeight: '600', fontSize: t.fontBody, color: t.ink },
    hint: { fontSize: t.fontCaption, color: t.muted },
    empty: { fontSize: t.fontSupport, color: t.muted, paddingVertical: t.space2 },
    row: {
      backgroundColor: t.surface,
      borderRadius: t.radiusMd,
      padding: t.space3,
      gap: t.space1,
    },
    type: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    status: { fontSize: t.fontSupport, color: t.ink },
    muted: { fontSize: t.fontCaption, color: t.muted },
    err: { fontSize: t.fontCaption, color: t.danger },
    time: { fontSize: t.fontCaption, color: t.muted },
  });
```

`JobsSection` 读 `service.jobs` / `service.chainId`，必须是 `observer`。不要解构 observable。

Modify `apps/app/src/features/chain-settings/index.tsx`：

(a) import：

```tsx
import { JobsSection } from './jobs-section';
```

(b) 在 `{isOwner ? (` 大块里，分享链接 `map` 结束之后、`<Text style={styles.sectionTitle}>危险区</Text>` **之前**插入：

```tsx
          <JobsSection />
```

只放在 `isOwner` 分支内，editor/viewer **看不见**该分区、**不会**打 jobs API。不要加「重试」按钮。

- [ ] **Step 4: 运行确认通过**

Run:

```
pnpm --filter @moment/app test -- src/lib/job-labels.test.ts
pnpm --filter @moment/app test
pnpm --filter @moment/app typecheck
pnpm --filter @moment/app lint
```

Expected: 全绿。`listChainJobs` 来自 api-client。`useFocusEffect` 从 `expo-router` 解析（Expo Router 6 再导出）。lint:tokens 零 hex。

- [ ] **Step 5: 全量 app 门禁**

Run:

```
pnpm --filter @moment/app test && pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app build
```

Expected: 全绿。禁止为了绿灯去改 `package.json` scripts / 新增 vitest.config / 改 `tokens.ts`。禁止改 api-client。

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/lib/job-labels.ts apps/app/src/lib/job-labels.test.ts apps/app/src/features/chain-settings/chain-settings.service.ts apps/app/src/features/chain-settings/jobs-section.tsx apps/app/src/features/chain-settings/index.tsx
git commit -m "feat(app): show owner processing jobs in chain settings"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/app test` / `typecheck` / `lint`（含 lint:tokens）/ `build` 全绿
- [ ] 冻结名可解析（app 消费，不重新定义 client）：`searchMoments(input)`、`listChainJobs(chainId)` 无第二参、`fetchMediaBlob(id, { variant? })`、`FeedQuery.personId|place`、`listChainMoments` 的 `personId`/`place`、`useMediaUri(id, { variant, fallbackToOriginal })`、Service 字段 `personId` / `place`（RailFilter 投影）
- [ ] 纯函数测试至少含：`media-variant.test.ts`（键分 variant）、`timeline-query.test.ts`（GET 带 personId/place 且无 personName；search body 无 before/order/source）、`search-summary.test.ts`、`job-labels.test.ts`（压缩图/索引 + 10_000）
- [ ] `mediaCacheKey` 为 `` `${mediaId}:${variant}` ``；original `fetchMediaBlob` 单参
- [ ] 未改 `packages/api-client/**` / `packages/dto/**` / `apps/server/**` / `apps/web/**` / `apps/app/package.json`
- [ ] 未出现名为 `SearchBar` 的组件；搜索是 `Field` + `returnKeyType="search"`
- [ ] 未封装 `/api/internal/*`；未调用 `mediaUrl`/`st`
- [ ] 详情页与往年今日人物/地点不可点；feed / 链时间线可点
- [ ] 手测清单：
  1. 首页点人物 chip → 列表只剩该人；再点同一人 / 点「外婆 ×」恢复；地点行同
  2. 切到另一条链 chip：人物筛选被清掉（偏差 16）；地点筛选仍在
  3. 搜索「去年今天和外婆」→ 结果替换时间线 + 摘要「找到：…」；点「关闭」回到 GET 时间线；chip 仍 AND
  4. 空搜索结果「没有找到相关时刻」+「退出搜索」；点人物无命中见「没有符合条件的时刻」，不是退出搜索
  5. 搜索限流（可对 server 打满）见「操作太频繁，请稍后再试」，无 Toast / Alert
  6. 有 `derivedUrl` 的卡片比详情大图更糊/更小；GIF/无 derived 仍原图、无「优化中」
  7. 详情视频播的是原片（非 512 WebP）；卡片视频封面优先 `posterDerivedUrl`
  8. 点 chip 不进详情（嵌套 Pressable）；长按作者卡片仍能出编辑菜单
  9. 链设置：owner 有「处理中」，editor 无；空态「没有处理中的任务」；停留 10s 以上网络面板能看到重复 GET jobs；离开设置页后不再刷
  10. 往年今日 / 时刻详情 chip 仍不可点；那年今日入口条仍在
  11. 浅色/深色：搜索 Label 不挤；chip 命中区不小于 44pt

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P9）：** §6.1 app `listChainMoments` personId/place（T3）；§6.2 `searchMoments`（T5）；§6.4 `listChainJobs`（T6）；§6.5 `useMediaUri` cache key + `fetchMediaBlob` variant + 客户端 derived 回退（T1–T2）；§7.1 chip 单选 + 清除 chip + rab 内存（T3–T4）；§7.2 Field 搜索 + POST + parsed 摘要 + 不带 before + 翻页 cursor 不改 parsed + 空态 + 429 humanError（T5）；§7.3 卡片 derived / 详情 original（T2）；§7.4 jobs owner 10s 轮询、进入分区才 load（T6）；§8 app 无分享 UI、不拼 st（偏差 5）；§9 app 条目以纯函数 + 手测钉死（偏差 15）；§11 P9 出口。P8 api-client 不在 Files。P10 e2e/`backfill:embed` 不在 Files。
- **占位符扫描：** 无 TBD / TODO /「适当处理」/「类似 Task N」/「Write tests for the above」。链页 timeline 段 / 搜索 / loadFirst 写全，不写「与 feed 同样」。
- **跨 Task 类型：** T1 `MediaVariant` / `cardImageVariant` 被 T2 逐字消费；T3 `togglePersonFilter({id,name})` 被 T4 点击与 T5 AND 搜索消费；`buildSearchInput` 被 T5 loadFirst/loadMore 消费；`JOBS_POLL_MS` 被 T6 interval 与测试消费。无 `clearLayers` 式改名。`personName` 只活在 Service/FilterChips。
- **不泄漏 P10：** 无 `backfill:embed`、无 server e2e、无 Lance、无 dto/server/web diff。
