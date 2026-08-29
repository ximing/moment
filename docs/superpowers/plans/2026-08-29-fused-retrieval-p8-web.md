# 融合检索 P8：api-client + web chip / 搜索 / 派生图 / 处理中 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地融合检索（M2）的客户端与 Web：`@moment/api-client` 增加 `searchMoments` / `listChainJobs`、`FeedQuery` 与 `listChainMoments` 的 `personId|place|happenedFrom|happenedTo`、以及 `mediaUrl`/`fetchMediaBlob` 的 `variant`/`st`；web 时间线人物/地点 chip 可点过滤、主列 `Field type=search` 走 `POST /api/search`、卡片用派生图而 Lightbox 用原图、链设置 owner「处理中」分区。

**Architecture:** api-client 不重复定义类型——`SearchInput`/`SearchResponse`/`SearchParsed`/`ChainJobListResponse` 全部从 `@moment/dto` 引用（P1/P7 Produces）。`mediaUrl` 是分享态 query 的唯一拼接点（已有 `?` 则 `&st=`）。web 过滤态仍是页面级 rab 内存（`RailFilter`），不进 URL；chip GET 走既有 `getFeed`+`feedQuery()`；搜索是同一 Service 上的模式开关（`searching`），翻页改 POST 且**不**带 `before`。派生图只改 `useMediaObjectUrl` 缓存键与 `MediaBlock` 卡片通道；Lightbox 固定 original。jobs 是 `ChainSettingsSections` 的新 `Section`，mount 时 load、可见时 10s 轮询。

**Tech Stack:** React 19 + Vite 7 + @rabjs/react（Service/observer）/ react-aria-components（`TextField type="search"`）/ lucide-react / Vitest 4 + jsdom + @testing-library/react（web 既有组件测试范式）/ api-client `tsx --test`（node:test，既有 fetch harness）。

**Spec:** `docs/superpowers/specs/2026-08-29-moment-fused-retrieval-design.md`（§6.1 `FeedQuery` camelCase、§6.2 `searchMoments`、§6.4 `listChainJobs`、§6.5 `mediaUrl`/`fetchMediaBlob`/`useMediaObjectUrl` cache key、§7.1–§7.4 UX、§8 分享页红线、§9 web 测试、§11 P8 出口）

**上游契约:**
- P1 `docs/superpowers/plans/2026-08-29-fused-retrieval-p1-dto-schema.md`：`searchInputSchema` / `SearchInput` / `SearchParsed` / `SearchTime` / `SearchResponse` / `INTENT_MAX_QUERY_CHARS` / `SEARCH_DEFAULT_LIMIT` / `SEARCH_MAX_LIMIT` / `ChainJobDto` / `ChainJobListResponse` / `MomentMedia.derivedUrl` / `posterDerivedUrl`（P3 已必填化）
- P2：GET `person_id`/`place`/`happened_from|to` 已生效；web 链页继续 `getFeed`+`chainIds`
- P3：`GET /api/media/:id?variant=derived`；serializer 仅 `ready` 才给非空 `derivedUrl`/`posterDerivedUrl`；404 `DERIVED_NOT_READY` 不回退原图（客户端回退）
- P6：`POST /api/search` JSON body；chip AND 仅 `personId`/`tagId`/`place`；**不**带 `before`；`parsed` 每页重算
- P7：`GET /api/chains/:chainId/jobs` owner；默认 `pending,failed`；无游标
- 冻结名：`.superpowers/orchestration/fused-retrieval/spec-review.md`

执行时假设 P1–P7 已在本分支落地。本计划 **dto / server / app 零 diff**。

## Global Constraints（只写本计划新增）

- **Token / 脚本红线（web-ui.md 设计体系基座 Owner）**：不得改 `apps/web/package.json` scripts、`apps/web/vitest.config.ts`、`apps/web/src/test/setup.ts`、`apps/web/src/styles/tokens.css` 的值或新增 token、`apps/web/tailwind.config.js` 语义映射。组件颜色/几何/z-index 只消费已发布语义 token。禁止页面写十六进制、一次性尺寸（`px-[18px]`、`h-[52px]`）、负边距通栏。
- **Field `type=search` 已存在，禁止新造 `SearchBar` 设计组件。** 搜索框是 `TextField`（`type="search"` + `isClearable` + `enterKeyHint="search"`）的表单封装，Label 按 Field 规范始终可见。
- 间距只使用 4 / 8 / 12 / 16 / 20 / 24 / 32；图标 Lucide；可交互元素必须有可见 `focus-visible`（`ring-focus` 或 Field 的 `ring-field-focus`）。
- rab 三层（`apps/web/CLAUDE.md`）：过滤/搜索态在页面 Service；跨域刷新仍只走 `'global'` 事件；组件不手写 fetch，一律 `src/api/client.ts` 的 `client`。
- **web 测试命令不得另开 script**：`pnpm --filter @moment/web test -- <file>`。api-client：`pnpm --filter @moment/api-client test`（tsx --test）。改 api-client 后必须 `pnpm --filter @moment/api-client build` 再跑 web 测试（web 消费 `dist/`）。
- **不封装** `POST/DELETE /api/internal/embeddings*`。`BA_AUTH_TOKEN` 不进前端包。
- 分享页 `readOnly` / `PublicShareMoment`：无搜索、无 jobs；persons/place 键不存在则不渲染；chip 保持非按钮。
- 过滤态 **不进 URL**。搜索 **不**把 `before` / `order` / `source` 放进 body。month-index 请求 **不加** `personId`/`place`。
- `mediaUrl`：`variant==='derived'` 才写 `?variant=derived`；`variant` 缺省或 `'original'` 与现网一样无 variant query。已有 `?` 则 `&st=`，否则 `?st=`。`st` 必须 `encodeURIComponent`。
- `useMediaObjectUrl` 缓存键必须是 `` `${mediaId}:${variant}` ``（`variant` 缺省当 `'original'`）。禁止 derived 与 original 共用 object URL。
- **不改** `apps/app/**`（`useMediaUri` 属 P9）。不改 dto / server。
- 每 Task 一个 commit（`feat(api-client): ...` / `feat(web): ...`）。**本计划的实现者执行 Commit 步骤。**

**Spec 引用与偏差（逐条注明）：**

1. **现网 feed-home / chain-home 主列并没有搜索框。** spec §7.2 写「既有 Field + Input/TextField，`type=search`」。Field 组件已支持该 type，但页面未挂。本计划在两页主列**新增** `TextField type="search"`（不是新的 SearchBar 设计组件）。Label 用「搜索时刻」（Field 规范 §3：Label 始终可见，Placeholder 只承担示例）。
2. **`RailFilter` 增加展示用 `personName?: string`。** 冻结名只有 `personId` / `place`。清除 chip 文案「外婆 ×」需要名字，而空结果时列表里已没有 `persons[]` 可回读。`personName` **不**进 `FeedQuery` / HTTP。
3. **时刻详情页（`/moments/:id`）人物/地点仍是 span。** spec §7.1「链内人物 chip：button」的页级 `personId` 只存在于 feed-home / chain-home 的 `RailFilter`。详情页无轨、过滤态不进 URL，点人无法写入页级 filter。本计划只给 `Timeline` 可选 `onPersonFilter` / `onPlaceFilter`；不传则保持 span（分享页、详情页）。
4. **链主页非 `timeline` tab 不渲染搜索框与 FilterChips。** 搜索结果替换的是 `moments` 时间线，聚合/地图视图不消费该列表。
5. **`Http.requestBlob` 追加 `options?: RequestOptions`。** spec 只冻 `fetchMediaBlob(id, { variant? })`；现网 `requestBlob(path)` 不能带 query。401 重放必须带上同一 `query`。
6. **`variant='original'`（或缺省）不写 `?variant=original`。** 与 P3「缺省 original 保持现网」一致，旧测试 `GET /api/media/md1` 继续绿。
7. **搜索 `limit` 用 dto `SEARCH_MAX_LIMIT`（50），与时间线 `getFeed(..., 50)` 同页大小。** spec 未规定客户端 limit；zod 最大 50，缺省 20 是 server 的 `SEARCH_DEFAULT_LIMIT`。显式传 50 避免搜索页比时间线短一截。
8. **`TextField` 的 isClearable 清空（空串）若当前在搜索模式则 `exitSearch`。** spec 只定义「关闭摘要 = 退出搜索」；空 q 不能 POST（`min(1)`），清空必须离开搜索，否则空态会卡在旧结果上。
9. **分享通道的 `url?st=` 抽到 `client.mediaUrl`；ChainCover / share-album 头像封面仍 `${url}?st=`。** 那些 URL 无 query，行为与现网逐字节相同。本计划改 MediaBlock / Lightbox / AudioBar（可能接到 `derivedUrl` 或将来 query 的稳定入口）。
10. **派生 blob 失败回退 original 在 hook 内完成**（`fallbackToOriginal: true`），不改 `useMediaObjectUrl` 的 `string | null` 返回值，以免 ChainCover / ChainMark 全线破坏。loading 与失败都是 `null`（现网如此）；回退时 extra 一次 original fetch。
11. **`filtered` 计入 `personId`/`place`，不计入 `searching`。** 搜索空态用另一份 EmptyState 文案「没有找到相关时刻」，避免和「没有符合条件的时刻」混成一次「清除筛选」误退出搜索。
12. **jobs 时间展示 `new Date(createdAt).toLocaleString()`。** 与 `ShareSection` 分享链接同一先例；不新增日期 token / 不引入新 formatter。
13. **「回到今天」并入 `FilterChips` 同一 sticky 行。** spec 清除 chip 在列表顶；现网 before 已是 sticky Button。合并避免两个 sticky 条叠 margin。
14. **搜索框不传 `maxLength`。** Field 只要设了 `maxLength` 就会在 Support 区常驻 `0/500` 计数，搜索框不像简介。提交时 `trim().slice(0, INTENT_MAX_QUERY_CHARS)`；超长粘贴先截断再 POST，不把服务端 400 当主路径。
15. **`submitSearch` / `exitSearch` 是 `async` 并 `await loadFirst()`。** 否则 `await submitSearch` 会在 POST 落地前返回，断言 `moments` 会红。`togglePersonFilter` 仍走既有同步 `setFilter` + `void loadFirst()`（与 `setFilter` 同形）。
16. **搜索进行中不拆掉 `before` chip。** POST 不带 `before`（冻结），但 `RailFilter.before` 仍在；关搜索后 GET 继续带日历锚。避免搜索失败/退出时把月份跳转偷偷清掉。
17. **`fetchMediaBlob` / hook 对 original 不传第二参。** Vitest `toHaveBeenCalledWith('m-1')` 把 `fn('m-1', undefined)` 当两参，会红。`variant==='derived'` 才传 `{ variant: 'derived' }`。

---

## File map

| 路径 | 职责 |
|---|---|
| `packages/api-client/src/http.ts` | `requestBlob(path, options?)` 透传 query |
| `packages/api-client/src/http.test.ts` | blob URL 带 `variant` |
| `packages/api-client/src/client.ts` | `FeedQuery` 四字段；`searchMoments`；`listChainJobs`；`mediaUrl`/`fetchMediaBlob`；`listChainMoments` query |
| `packages/api-client/src/client.test.ts` | 上述路由与 query 拼接 |
| `apps/web/src/media/useMediaObjectUrl.ts` | 缓存键含 variant；derived 失败回退 original |
| `apps/web/src/media/useMediaObjectUrl.test.tsx` | 分缓存 / 回退 / 旧共享语义 |
| `apps/web/src/media/MediaBlock.tsx` | 卡片 derived；分享走 `mediaUrl` |
| `apps/web/src/media/MediaBlock.test.tsx` | derived vs original vs `&st=` |
| `apps/web/src/timeline/lightbox.tsx` | 只 original；分享走 `mediaUrl` |
| `apps/web/src/timeline/lightbox.test.tsx` | 分享 `?st=`；不请求 derived |
| `apps/web/src/media/AudioBar.tsx` | 分享走 `mediaUrl` |
| `apps/web/src/timeline/timeline-rail.tsx` | `RailFilter.personId` / `personName` / `place` |
| `apps/web/src/lib/feed.ts` | `feedQuery` 带出 `personId`/`place` |
| `apps/web/src/lib/feed.test.ts` | 纯函数 |
| `apps/web/src/lib/search-summary.ts` | `formatSearchParsed` |
| `apps/web/src/lib/search-summary.test.ts` | |
| `apps/web/src/pages/feed-home/feed-home.service.ts` | chip + 搜索模式 |
| `apps/web/src/pages/feed-home/feed-home.service.test.ts` | |
| `apps/web/src/pages/chain-home/chain-home.service.ts` | 同上，`chainIds:[current]` |
| `apps/web/src/pages/chain-home/chain-home.service.test.ts` | |
| `apps/web/src/timeline/moment-sheet.tsx` | 可选回调 → button |
| `apps/web/src/timeline/moment-sheet-people-place.test.tsx` | 可点 vs 分享 span |
| `apps/web/src/timeline/timeline.tsx` | 把回调传进 sheet |
| `apps/web/src/timeline/filter-chips.tsx` | 列表顶清除 chip + 回到今天 |
| `apps/web/src/timeline/filter-chips.test.tsx` | |
| `apps/web/src/timeline/search-field.tsx` | `TextField type=search` 表单 |
| `apps/web/src/timeline/search-field.test.tsx` | |
| `apps/web/src/pages/feed-home/index.tsx` | 搜索框 + FilterChips + 摘要 Banner |
| `apps/web/src/pages/chain-home/index.tsx` | 同上（仅 timeline tab） |
| `apps/web/src/pages/chain-settings/chain-settings.service.ts` | `jobs` / `loadJobs` |
| `apps/web/src/pages/chain-settings/sections.tsx` | `Section` += `'jobs'` |
| `apps/web/src/pages/chain-settings/jobs-section.tsx` | 列表 + 10s 轮询 |
| `apps/web/src/pages/chain-settings/jobs-section.test.tsx` | owner 可见 / 轮询 / 空态 |
| `apps/web/src/pages/chain-settings/chain-settings.service.test.ts` | `loadJobs` |

**本计划明确不改：** `packages/dto/**`、`apps/server/**`、`apps/app/**`、`apps/web/package.json`、`apps/web/vitest.config.ts`、`apps/web/src/test/setup.ts`、`apps/web/src/styles/tokens.css`、`apps/web/tailwind.config.js`、`src/feed/cursor.ts`、`chain-policy.ts`、internal embeddings client、`docs/superpowers/plans/CONVENTIONS.md`。

---

### Task 1: api-client — FeedQuery 四字段 + searchMoments + listChainJobs + mediaUrl/fetchMediaBlob variant/st

**Files:**
- Modify: `packages/api-client/src/http.ts`（`requestBlob` 第二参）
- Modify: `packages/api-client/src/http.test.ts`（追加 blob query 用例）
- Modify: `packages/api-client/src/client.ts`（类型 import、`FeedQuery`、`MomentClient`、实现）
- Modify: `packages/api-client/src/client.test.ts`（追加测试，不改既有 URL 断言）

**Interfaces:**
- Consumes:
  - P1 `@moment/dto`：`SearchInput` / `SearchResponse` / `ChainJobListResponse`
  - 既有 `Http.request` / `Http.requestBlob` / `buildUrl`（undefined query 跳过）
  - 既有 `FeedQuery.{ cursor, chainIds, tagId, order, limit, before }`
  - 既有 `mediaUrl(mediaId: string): string`、`fetchMediaBlob(mediaId: string): Promise<Blob>`
- Produces（后续 Task / P9 逐字消费，不得改名）:
  - `FeedQuery.personId?: string`
  - `FeedQuery.place?: string`
  - `FeedQuery.happenedFrom?: string`
  - `FeedQuery.happenedTo?: string`
  - `MomentClient.getFeed` 把上述四键序列化为 `person_id` / `place` / `happened_from` / `happened_to`
  - `MomentClient.listChainMoments(chainId, query?: { cursor?: string; limit?: number; before?: string; personId?: string; place?: string; happenedFrom?: string; happenedTo?: string })`
  - `MomentClient.searchMoments(input: SearchInput): Promise<SearchResponse>` — `POST /api/search` JSON body，不走 query string
  - `MomentClient.listChainJobs(chainId: string, query?: { status?: string; limit?: number }): Promise<ChainJobListResponse>` — `GET /api/chains/:chainId/jobs`
  - `MomentClient.mediaUrl(mediaId: string, opts?: { variant?: 'original' | 'derived'; st?: string }): string`
  - `MomentClient.fetchMediaBlob(mediaId: string, opts?: { variant?: 'original' | 'derived' }): Promise<Blob>`
  - `Http.requestBlob(path: string, options?: RequestOptions): Promise<Blob>`
  - 行为：缺省 `mediaUrl`/`fetchMediaBlob` 与现网 URL 逐字相同；`variant==='derived'` 才加 `variant=derived`；`st` 已有 `?` 则 `&st=` 否则 `?st=`；不封装 `/api/internal/*`

- [ ] **Step 1: 写失败测试**

Modify `packages/api-client/src/http.test.ts` — 文件末尾追加：

```ts
test('requestBlob 把 query 拼进 URL（P8 fetchMediaBlob variant=derived）', async () => {
  const store = memoryStore({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 });
  let url = '';
  const http = new Http({
    baseUrl: 'http://x',
    tokenStore: store,
    fetchImpl: async (u) => {
      url = String(u);
      return new Response(new Blob(['img']), { status: 200 });
    },
  });
  const blob = await http.requestBlob('/api/media/md1', { query: { variant: 'derived' } });
  assert.equal(url, 'http://x/api/media/md1?variant=derived');
  assert.equal(await blob.text(), 'img');
});

test('requestBlob 401 重放带上同一 query（偏差 5）', async () => {
  const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
  const urls: string[] = [];
  const http = new Http({
    baseUrl: 'http://x',
    tokenStore: store,
    fetchImpl: async (u, init) => {
      const url = String(u);
      if (url.includes('/api/auth/refresh')) {
        return jsonResponse(200, {
          user: { id: 'u1', email: 'a@b.c', nickname: 'a', createdAt: '2026-01-01T00:00:00Z' },
          tokens: { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 },
        });
      }
      urls.push(url);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      if (auth === 'Bearer expired') {
        return jsonResponse(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      }
      return new Response(new Blob(['img']), { status: 200 });
    },
  });
  const blob = await http.requestBlob('/api/media/md1', { query: { variant: 'derived' } });
  assert.deepEqual(urls, [
    'http://x/api/media/md1?variant=derived',
    'http://x/api/media/md1?variant=derived',
  ]);
  assert.equal(await blob.text(), 'img');
});
```

Modify `packages/api-client/src/client.test.ts` — 文件末尾追加：

```ts
test('getFeed / listChainMoments 序列化 personId/place/happenedFrom/happenedTo 为 snake_case', async () => {
  const { client, calls } = harness();
  await client.getFeed({
    personId: '123e4567-e89b-12d3-a456-426614174000',
    place: '朝阳公园',
    happenedFrom: '2026-08-01T00:00:00.000Z',
    happenedTo: '2026-08-31T23:59:59.999Z',
    limit: 50,
  });
  await client.listChainMoments('c1', {
    personId: '123e4567-e89b-12d3-a456-426614174000',
    place: '朝阳公园',
    happenedFrom: '2026-08-01T00:00:00.000Z',
    happenedTo: '2026-08-31T23:59:59.999Z',
  });
  assert.equal(
    calls[0]!.url,
    'http://x/api/feed?limit=50&person_id=123e4567-e89b-12d3-a456-426614174000&place=%E6%9C%9D%E9%98%B3%E5%85%AC%E5%9B%AD&happened_from=2026-08-01T00%3A00%3A00.000Z&happened_to=2026-08-31T23%3A59%3A59.999Z',
  );
  assert.equal(
    calls[1]!.url,
    'http://x/api/chains/c1/moments?person_id=123e4567-e89b-12d3-a456-426614174000&place=%E6%9C%9D%E9%98%B3%E5%85%AC%E5%9B%AD&happened_from=2026-08-01T00%3A00%3A00.000Z&happened_to=2026-08-31T23%3A59%3A59.999Z',
  );
});

test('searchMoments：POST /api/search JSON body（不走 query string；不带 before/order/source）', async () => {
  const { client, calls } = harness();
  await client.searchMoments({
    q: '去年今天和外婆',
    tzOffset: -480,
    chainIds: ['123e4567-e89b-12d3-a456-426614174000'],
    personId: '123e4567-e89b-12d3-a456-426614174001',
    tagId: '123e4567-e89b-12d3-a456-426614174002',
    place: '朝阳公园',
    limit: 50,
    cursor: 'cur',
  });
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.url, 'http://x/api/search');
  assert.deepEqual(calls[0]!.body, {
    q: '去年今天和外婆',
    tzOffset: -480,
    chainIds: ['123e4567-e89b-12d3-a456-426614174000'],
    personId: '123e4567-e89b-12d3-a456-426614174001',
    tagId: '123e4567-e89b-12d3-a456-426614174002',
    place: '朝阳公园',
    limit: 50,
    cursor: 'cur',
  });
  assert.equal('before' in (calls[0]!.body as object), false);
  assert.equal('order' in (calls[0]!.body as object), false);
  assert.equal('source' in (calls[0]!.body as object), false);
});

test('listChainJobs：GET /api/chains/:chainId/jobs；query 可选 status/limit', async () => {
  const { client, calls } = harness();
  await client.listChainJobs('c1');
  await client.listChainJobs('c1', { status: 'pending,failed', limit: 50 });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET http://x/api/chains/c1/jobs',
      'GET http://x/api/chains/c1/jobs?status=pending%2Cfailed&limit=50',
    ],
  );
});

test('mediaUrl / fetchMediaBlob：variant + st 拼接（已有 ? 则 &st=）', async () => {
  const { client, calls } = harness();
  assert.equal(client.mediaUrl('md1'), 'http://x/api/media/md1');
  assert.equal(client.mediaUrl('md1', { variant: 'original' }), 'http://x/api/media/md1');
  assert.equal(client.mediaUrl('md1', { variant: 'derived' }), 'http://x/api/media/md1?variant=derived');
  assert.equal(client.mediaUrl('md1', { st: 'tok en' }), 'http://x/api/media/md1?st=tok%20en');
  assert.equal(
    client.mediaUrl('md1', { variant: 'derived', st: 'tok en' }),
    'http://x/api/media/md1?variant=derived&st=tok%20en',
  );
  await client.fetchMediaBlob('md1');
  await client.fetchMediaBlob('md1', { variant: 'original' });
  await client.fetchMediaBlob('md1', { variant: 'derived' });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET http://x/api/media/md1',
      'GET http://x/api/media/md1',
      'GET http://x/api/media/md1?variant=derived',
    ],
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL——`client.searchMoments is not a function`（或 `listChainJobs is not a function` / `mediaUrl` 第二参被忽略导致 derived URL 不含 query）。至少一路新测试红才进 Step 3。既有 `mediaUrl('md1')` 与 `fetchMediaBlob('md1')` 用例必须仍按现网 URL 写，不能先改旧断言来制造红灯。

- [ ] **Step 3: 最小实现**

(a) Modify `packages/api-client/src/http.ts` — 把

```ts
  async requestBlob(path: string): Promise<Blob> {
    const first = await this.doFetch(path, {});
```

换成（401 重放那一行同样把 `{}` 换成 `options`）：

```ts
  async requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
    const first = await this.doFetch(path, options);
    if (first.status === 401) {
      const refreshToken = await this.tokenStore.getRefreshToken();
      if (!refreshToken) throw await toApiError(first);
      const accessToken = await this.refresh();
      const second = await this.doFetch(path, options, accessToken);
      if (!second.ok) {
        if (second.status === 401) await Promise.resolve(this.tokenStore.clear()).catch(() => undefined);
        throw await toApiError(second);
      }
      return second.blob();
    }
    if (!first.ok) throw await toApiError(first);
    return first.blob();
  }
```

其余 `requestBlob` 方法体（401 / !ok / blob）保持与现网同一控制流，只是两次 `doFetch` 都传入 `options`。

(b) Modify `packages/api-client/src/client.ts`：

dto 类型 import 块按字母序插入 `SearchInput`、`SearchResponse`、`ChainJobListResponse`（`ChainDetailDto` 之后插 `ChainJobListResponse`；`ShareLinkListResponse` 之后插 `SearchInput, SearchResponse`）：

```ts
  ChainJobListResponse,
```

```ts
  SearchInput,
  SearchResponse,
```

`FeedQuery` 在 `before?: string;` 之后追加：

```ts
  personId?: string;
  place?: string;
  happenedFrom?: string;
  happenedTo?: string;
```

`listChainMoments` 的 query 类型改为：

```ts
  listChainMoments(chainId: string, query?: {
    cursor?: string;
    limit?: number;
    before?: string;
    personId?: string;
    place?: string;
    happenedFrom?: string;
    happenedTo?: string;
  }): Promise<Pick<FeedResponse, 'moments' | 'nextCursor'>>;
```

`getFeed` 行之后追加：

```ts
  /** POST /api/search（spec fused-retrieval §6.2）；JSON body，不走 query string */
  searchMoments(input: SearchInput): Promise<SearchResponse>;
```

`mediaUrl` / `fetchMediaBlob` 两行替换为：

```ts
  mediaUrl(mediaId: string, opts?: { variant?: 'original' | 'derived'; st?: string }): string;
  /** Web `<img>/<video>` 渲染的唯一来源：Blob → URL.createObjectURL。variant 缺省 original（无 query） */
  fetchMediaBlob(mediaId: string, opts?: { variant?: 'original' | 'derived' }): Promise<Blob>;
```

`listRecaps` 两行之后追加：

```ts
  /** GET /api/chains/:chainId/jobs（spec §6.4，仅 owner；query 省略则服务端默认 pending,failed） */
  listChainJobs(chainId: string, query?: { status?: string; limit?: number }): Promise<ChainJobListResponse>;
```

实现对象：

`listChainMoments` 的 `query:` 对象追加四键：

```ts
        query: {
          cursor: query?.cursor,
          limit: query?.limit,
          before: query?.before,
          person_id: query?.personId,
          place: query?.place,
          happened_from: query?.happenedFrom,
          happened_to: query?.happenedTo,
        },
```

`getFeed` 的 `query:` 对象追加：

```ts
          person_id: query?.personId,
          place: query?.place,
          happened_from: query?.happenedFrom,
          happened_to: query?.happenedTo,
```

`getFeed` 实现块之后追加：

```ts
    searchMoments: (input) => http.request('/api/search', { method: 'POST', body: input }),
```

`mediaUrl` / `fetchMediaBlob` 替换为：

```ts
    mediaUrl: (mediaId, opts) => {
      let url = `${baseUrl}/api/media/${mediaId}`;
      if (opts?.variant === 'derived') url += '?variant=derived';
      if (opts?.st) url += `${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(opts.st)}`;
      return url;
    },
    fetchMediaBlob: (mediaId, opts) =>
      http.requestBlob(
        `/api/media/${mediaId}`,
        opts?.variant === 'derived' ? { query: { variant: 'derived' } } : {},
      ),
```

`getRecap` 行之后追加：

```ts
    listChainJobs: (chainId, query) =>
      http.request(`/api/chains/${chainId}/jobs`, {
        query: { status: query?.status, limit: query?.limit },
      }),
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/api-client test`
Expected: PASS，新增用例全过；既有 `mediaUrl('md1') === 'http://x/api/media/md1'`、`fetchMediaBlob` 无 variant 的 `GET http://x/api/media/md1`、空 `getFeed` 无 query string 均不回归。

- [ ] **Step 5: 门禁 + 构建（web 后续 Task 消费 dist）**

Run: `pnpm --filter @moment/api-client typecheck && pnpm --filter @moment/api-client lint && pnpm --filter @moment/api-client build`
Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/http.ts packages/api-client/src/http.test.ts packages/api-client/src/client.ts packages/api-client/src/client.test.ts
git commit -m "feat(api-client): add search, chain jobs, feed filters and media variant URLs"
```

---

### Task 2: `useMediaObjectUrl` 缓存键含 variant；derived 失败回退 original

**Files:**
- Modify: `apps/web/src/media/useMediaObjectUrl.ts`
- Modify: `apps/web/src/media/useMediaObjectUrl.test.tsx`

**Interfaces:**
- Consumes: Task 1 `client.fetchMediaBlob(id, { variant? })`
- Produces:
  - `useMediaObjectUrl(mediaId: string | null, opts?: { variant?: 'original' | 'derived'; fallbackToOriginal?: boolean }): string | null`
  - 缓存键 `` `${mediaId}:${variant}` ``，`variant` 缺省 `'original'`
  - `fallbackToOriginal: true` 且 `variant==='derived'`：derived fetch 失败后改打 original，返回 original 的 object URL
  - 既有：同键共享一次 fetch；最后一消费者卸载才 revoke；`mediaId===null` 不请求；original 失败仍删 entry 以便下次挂载重试

- [ ] **Step 1: 写失败测试**

Modify `apps/web/src/media/useMediaObjectUrl.test.tsx`：

(a) `Consumer` 下方追加：

```tsx
function ConsumerWithOpts({
  mediaId,
  variant,
  fallbackToOriginal,
}: {
  mediaId: string | null;
  variant?: 'original' | 'derived';
  fallbackToOriginal?: boolean;
}) {
  return (
    <output data-testid="media-url">
      {useMediaObjectUrl(mediaId, { variant, fallbackToOriginal }) ?? ''}
    </output>
  );
}
```

(b) 文件末尾、最后一个 `describe` 的 `});` 之前追加一个新 `describe`（不要改既有「同一 mediaId 挂 20 个消费者」——缺省 variant 仍共享）：

```tsx
describe('variant 缓存键与 derived 回退（spec fused-retrieval §6.5 / §7.3）', () => {
  it('同一 mediaId 的 original 与 derived 各 fetch 一次，object URL 不共享', async () => {
    const dOrig = deferred<Blob>();
    const dDer = deferred<Blob>();
    api.fetchMediaBlob.mockImplementation((_id: string, opts?: { variant?: string }) =>
      opts?.variant === 'derived' ? dDer.promise : dOrig.promise,
    );
    const orig = render(<ConsumerWithOpts mediaId="m-1" variant="original" />);
    const der = render(<ConsumerWithOpts mediaId="m-1" variant="derived" />);
    expect(api.fetchMediaBlob).toHaveBeenCalledTimes(2);
    expect(api.fetchMediaBlob).toHaveBeenCalledWith('m-1');
    expect(api.fetchMediaBlob).toHaveBeenCalledWith('m-1', { variant: 'derived' });

    await act(async () => dOrig.resolve(new Blob(['o'])));
    await act(async () => dDer.resolve(new Blob(['d'])));
    expect(renderedUrls().sort()).toEqual(['blob:obj-1', 'blob:obj-2']);
    orig.unmount();
    der.unmount();
  });

  it('derived 失败且 fallbackToOriginal：改打 original，不把死链留给用户', async () => {
    const dDer = deferred<Blob>();
    const dOrig = deferred<Blob>();
    api.fetchMediaBlob.mockImplementation((_id: string, opts?: { variant?: string }) =>
      opts?.variant === 'derived' ? dDer.promise : dOrig.promise,
    );
    const view = render(<ConsumerWithOpts mediaId="m-1" variant="derived" fallbackToOriginal />);
    expect(api.fetchMediaBlob).toHaveBeenCalledWith('m-1', { variant: 'derived' });

    await act(async () => dDer.reject(new Error('DERIVED_NOT_READY')));
    expect(api.fetchMediaBlob).toHaveBeenCalledWith('m-1');
    await act(async () => dOrig.resolve(new Blob(['o'])));
    expect(renderedUrls()).toEqual(['blob:obj-1']);
    view.unmount();
  });
});
```

既有用例继续 `toHaveBeenCalledWith('m-1')`（original **省略**第二参，禁止传 `undefined`）。不要改它们的期望来迁就新签名。`acquire` 对 original 必须 `client.fetchMediaBlob(mediaId)` 单参。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- src/media/useMediaObjectUrl.test.tsx`
Expected: FAIL——`useMediaObjectUrl` 忽略第二参，original/derived 共享一次 fetch（`toHaveBeenCalledTimes(2)` 失败），或 `fetchMediaBlob` 从未以 `{ variant: 'derived' }` 调用。

- [ ] **Step 3: 最小实现**

将 `apps/web/src/media/useMediaObjectUrl.ts` **整文件替换**为：

```ts
import { useEffect, useState } from 'react';
import { client } from '@/api/client';

// 模块级 object URL 去重缓存（chain-appearance §7.5 + fused-retrieval §6.5）：
// - 缓存键 `${mediaId}:${variant}`（variant 缺省 original），禁止 derived 与 original 共用；
// - 同一键的所有消费者共享一次 fetchMediaBlob 与一个 object URL；
// - 引用计数：最后一个消费者卸载才 revoke URL 并移除 entry；
// - original 失败：移出 entry，后续挂载可重试；
// - derived + fallbackToOriginal：失败后改打 original；
// - 分享页请用 client.mediaUrl(..., { st })，不要走这里的认证 blob 通道。

type MediaVariant = 'original' | 'derived';

interface MediaUrlEntry {
  promise: Promise<Blob>;
  url: string | null;
  refs: number;
  listeners: Set<(url: string | null, failed?: boolean) => void>;
}

const entries = new Map<string, MediaUrlEntry>();

function cacheKey(mediaId: string, variant: MediaVariant): string {
  return `${mediaId}:${variant}`;
}

function acquire(mediaId: string, variant: MediaVariant): MediaUrlEntry {
  const key = cacheKey(mediaId, variant);
  let entry = entries.get(key);
  if (entry) return entry;

  const promise =
    variant === 'derived'
      ? client.fetchMediaBlob(mediaId, { variant: 'derived' })
      : client.fetchMediaBlob(mediaId);
  entry = { promise, url: null, refs: 0, listeners: new Set() };
  entries.set(key, entry);

  promise
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      if (entries.get(key) !== entry || entry.refs <= 0) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      entry.url = objectUrl;
      for (const listener of entry.listeners) listener(objectUrl);
    })
    .catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
      for (const listener of entry.listeners) listener(null, true);
    });

  return entry;
}

function release(mediaId: string, variant: MediaVariant, entry: MediaUrlEntry): void {
  const key = cacheKey(mediaId, variant);
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.refs = 0;
  if (entries.get(key) === entry) entries.delete(key);
  if (entry.url !== null) {
    URL.revokeObjectURL(entry.url);
    entry.url = null;
  }
}

export function useMediaObjectUrl(
  mediaId: string | null,
  opts?: { variant?: MediaVariant; fallbackToOriginal?: boolean },
): string | null {
  const requested: MediaVariant = opts?.variant ?? 'original';
  const fallback = Boolean(opts?.fallbackToOriginal && requested === 'derived');
  const requestKey = `${mediaId ?? ''}:${requested}`;

  const [effective, setEffective] = useState<MediaVariant>(requested);
  const [prevKey, setPrevKey] = useState(requestKey);
  const [url, setUrl] = useState<string | null>(() =>
    mediaId ? (entries.get(cacheKey(mediaId, requested))?.url ?? null) : null,
  );

  if (prevKey !== requestKey) {
    setPrevKey(requestKey);
    setEffective(requested);
    setUrl(mediaId ? (entries.get(cacheKey(mediaId, requested))?.url ?? null) : null);
  }

  useEffect(() => {
    if (!mediaId) return;
    const variant = effective;
    const entry = acquire(mediaId, variant);
    entry.refs += 1;
    const listener = (next: string | null, failed?: boolean) => {
      if (failed && fallback && variant === 'derived') {
        setEffective('original');
        return;
      }
      setUrl(next);
    };
    entry.listeners.add(listener);
    const ready = entry.url;
    if (ready !== null) {
      queueMicrotask(() => {
        if (entry.listeners.has(listener)) listener(ready);
      });
    }
    return () => {
      entry.listeners.delete(listener);
      release(mediaId, variant, entry);
    };
  }, [mediaId, effective, fallback]);

  return url;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- src/media/useMediaObjectUrl.test.tsx`
Expected: PASS，旧共享/回收/null 用例与新 variant/回退用例全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/media/useMediaObjectUrl.ts apps/web/src/media/useMediaObjectUrl.test.tsx
git commit -m "feat(web): key media object URLs by variant and fall back from derived"
```

---

### Task 3: MediaBlock 卡片用派生图；Lightbox 原图；分享 `mediaUrl` 防 `?st=` 破坏 query

**Files:**
- Modify: `apps/web/src/media/MediaBlock.tsx`
- Modify: `apps/web/src/media/MediaBlock.test.tsx`
- Modify: `apps/web/src/timeline/lightbox.tsx`
- Modify: `apps/web/src/timeline/lightbox.test.tsx`
- Modify: `apps/web/src/media/AudioBar.tsx`

**Interfaces:**
- Consumes:
  - Task 1 `client.mediaUrl(id, { variant?, st? })`
  - Task 2 `useMediaObjectUrl(id, { variant, fallbackToOriginal })`
  - P3 `MomentMedia.derivedUrl` / `posterDerivedUrl`（仅 `ready` 非空）
- Produces:
  - 认证卡片：`derivedUrl` 非空 → `variant:'derived'` + `fallbackToOriginal`；否则 original。无「优化中」角标
  - 认证视频封面：`posterDerivedUrl` 非空则 `posterMediaId` + derived，否则 `posterMediaId` original
  - Lightbox / 点开大图：只用 original（`useMediaObjectUrl(id)` 不传 derived）
  - 分享：`client.mediaUrl(id, { variant: derivedUrl ? 'derived' : undefined, st })`；禁止 `` `${derivedUrl}?st=` ``
  - 播放中的 `<video src>` 始终 original（视频文件本身无 derived）
  - AudioBar 分享改为 `mediaUrl(id, { st })`（无 variant，URL 仍是 `?st=`）

- [ ] **Step 1: 写失败测试**

Modify `apps/web/src/media/MediaBlock.test.tsx`：

(a) 在 `vi.mock('./useMediaObjectUrl'...)` 之前加入 api-client 桩（`mediaUrl` 复刻 Task 1 拼接规则，让分享断言不依赖 `dist` 实现细节以外的行为——规则与冻结名相同）：

```ts
vi.mock('@/api/client', () => ({
  client: {
    mediaUrl(id: string, opts?: { variant?: 'original' | 'derived'; st?: string }) {
      let url = `/api/media/${id}`;
      if (opts?.variant === 'derived') url += '?variant=derived';
      if (opts?.st) url += `${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(opts.st)}`;
      return url;
    },
  },
}));
```

(b) 把 `useMediaObjectUrl` mock 改成记录第二参（默认仍 `blob:mock-${id}`）：

```ts
vi.mock('./useMediaObjectUrl', () => ({
  useMediaObjectUrl: vi.fn(
    (mediaId: string | null, _opts?: { variant?: string; fallbackToOriginal?: boolean }) =>
      mediaId ? `blob:mock-${mediaId}` : null,
  ),
}));
```

(c) `image` / `video` helper 补 P3 字段（若 P3 已加则保持；本计划测试一律写齐）：

```ts
function image(
  id: string,
  width = 64,
  height = 48,
  sortOrder = 0,
  derivedUrl: string | null = null,
): MomentMedia {
  return {
    id,
    url: `/api/media/${id}`,
    mime: 'image/jpeg',
    width,
    height,
    duration: null,
    sortOrder,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl,
    posterDerivedUrl: null,
  };
}

function video(
  id: string,
  poster?: { posterMediaId: string; posterUrl: string; posterDerivedUrl: string | null },
): MomentMedia {
  return {
    id,
    url: `/api/media/${id}`,
    mime: 'video/mp4',
    width: 1280,
    height: 720,
    duration: 12,
    sortOrder: 0,
    posterMediaId: poster?.posterMediaId ?? null,
    posterUrl: poster?.posterUrl ?? null,
    derivedUrl: null,
    posterDerivedUrl: poster?.posterDerivedUrl ?? null,
  };
}
```

(d) 在 `describe('URL 语义')` 末尾追加：

```ts
  it('认证模式：有 derivedUrl 时 useMediaObjectUrl(id, { variant: derived, fallbackToOriginal })', () => {
    render(
      <MediaBlock
        media={[image('media-1', 64, 48, 0, '/api/media/media-1?variant=derived')]}
      />,
    );
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-1', {
      variant: 'derived',
      fallbackToOriginal: true,
    });
  });

  it('认证模式：无 derivedUrl 不传 derived，无优化中角标', () => {
    const { container } = render(<MediaBlock media={[image('media-1')]} />);
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-1', {
      variant: 'original',
      fallbackToOriginal: false,
    });
    expect(container.textContent).not.toMatch(/优化中/);
  });

  it('分享模式：derivedUrl 走 mediaUrl variant=derived + &st=，禁止第二段 ?st=', () => {
    const token = 'tok en';
    const { container } = render(
      <MediaBlock
        media={[image('media-1', 64, 48, 0, '/api/media/media-1?variant=derived')]}
        shareToken={token}
      />,
    );
    const src = container.querySelector('img')!.getAttribute('src');
    expect(src).toBe('/api/media/media-1?variant=derived&st=tok%20en');
    expect(src).not.toContain('?variant=derived?st=');
    for (const call of mockUseMediaObjectUrl.mock.calls) expect(call[0]).toBeNull();
  });

  it('分享模式：无 derivedUrl 仍是 ?st=（现网稳定入口）', () => {
    const { container } = render(<MediaBlock media={[image('media-1')]} shareToken={'tok en'} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/media/media-1?st=tok%20en');
  });

  it('认证视频封面优先 posterDerivedUrl', () => {
    render(
      <MediaBlock
        media={[
          video('media-v1', {
            posterMediaId: 'poster-1',
            posterUrl: '/api/media/poster-1',
            posterDerivedUrl: '/api/media/poster-1?variant=derived',
          }),
        ]}
      />,
    );
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('poster-1', {
      variant: 'derived',
      fallbackToOriginal: true,
    });
  });
```

既有「分享模式：无 derived 的 `?st=tok%20en`」必须继续 PASS。

把既有 `describe('URL 语义')` 第一条认证用例的单参断言整段换成（ImageOne / VideoOne 现在**总是**传第二参，Vitest `toHaveBeenCalledWith('media-1')` 不接受多余参数）：

```ts
  it('认证模式：图片与视频都经 useMediaObjectUrl(media.id) 取 blob object URL', async () => {
    const user = userEvent.setup();
    const first = render(<MediaBlock media={[image('media-1')]} />);
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-1', {
      variant: 'original',
      fallbackToOriginal: false,
    });
    expect(first.container.querySelector('img')).toHaveAttribute('src', 'blob:mock-media-1');
    first.unmount();

    mockUseMediaObjectUrl.mockClear();
    const { container } = render(<MediaBlock media={[video('media-v1')]} />);
    expect(mockUseMediaObjectUrl.mock.calls.some((c) => c[0] === null)).toBe(true);
    await user.click(screen.getByRole('button', { name: '播放视频' }));
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-v1', {
      variant: 'original',
      fallbackToOriginal: false,
    });
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:mock-media-v1');
  });
```

分享用例里「`not.toHaveBeenCalledWith('media-1')`」仍有效（第一参不是 media-1）；`for (const call … call[0]).toBeNull()` 保持。

再追加一条分享封面 derived（spec §7.3，禁止 `` posterDerivedUrl?st= ``）：

```ts
  it('分享模式：posterDerivedUrl 走 mediaUrl variant=derived + &st=', () => {
    const { container } = render(
      <MediaBlock
        media={[
          video('media-v1', {
            posterMediaId: 'poster-1',
            posterUrl: '/api/media/poster-1',
            posterDerivedUrl: '/api/media/poster-1?variant=derived',
          }),
        ]}
        shareToken={'tok en'}
      />,
    );
    const player = container.querySelector('video')!;
    expect(player.getAttribute('poster')).toBe('/api/media/poster-1?variant=derived&st=tok%20en');
    expect(player.getAttribute('poster')).not.toContain('?variant=derived?st=');
  });
```

Modify `apps/web/src/timeline/lightbox.test.tsx`：

(a) 在 `vi.mock('@/media/useMediaObjectUrl'...)` 之前加入（Lightbox 现网 mock 路径是 `@/media/useMediaObjectUrl`，**不是** `./useMediaObjectUrl`；分享改走 `client.mediaUrl`，必须桩）：

```ts
vi.mock('@/api/client', () => ({
  client: {
    mediaUrl(id: string, opts?: { variant?: 'original' | 'derived'; st?: string }) {
      let url = `/api/media/${id}`;
      if (opts?.variant === 'derived') url += '?variant=derived';
      if (opts?.st) url += `${url.includes('?') ? '&' : '?'}st=${encodeURIComponent(opts.st)}`;
      return url;
    },
  },
}));
```

Lightbox **不**传 hook 第二参（高清档 original 走缺省），因此既有 `toHaveBeenCalledWith('media-2')` 保持单参。

(b) `image`/`video` helper 补 `derivedUrl: '/api/media/${id}?variant=derived'`（灯箱即使行上有 derived 也不该用）。`posterDerivedUrl: null`。

(c) 在 `describe('媒体渲染与 URL 语义')` 追加：

```ts
  it('认证模式：即使 derivedUrl 非空也只请求 original（Lightbox 高清档）', () => {
    render(<Lightbox items={ITEMS} index={1} onClose={() => undefined} onIndex={() => undefined} />);
    expect(mockUseMediaObjectUrl).toHaveBeenCalledWith('media-2');
    const derivedCalls = mockUseMediaObjectUrl.mock.calls.filter(
      (c) => c[1] && (c[1] as { variant?: string }).variant === 'derived',
    );
    expect(derivedCalls).toHaveLength(0);
  });
```

既有分享用例期望 `/api/media/media-2?st=tok%20en` 保持不变（Lightbox 不传 variant）。

- [ ] **Step 2: 运行确认失败**

Run:
```
pnpm --filter @moment/web test -- src/media/MediaBlock.test.tsx
pnpm --filter @moment/web test -- src/timeline/lightbox.test.tsx
```
Expected: FAIL——MediaBlock 仍 `useMediaObjectUrl(id)` 单参；分享 derived 图 src 变成非法的 `/api/media/media-1?variant=derived?st=tok%20en` 或未走 `mediaUrl`。

- [ ] **Step 3: 最小实现**

Modify `apps/web/src/media/MediaBlock.tsx`：

(a) 顶部 import 增加 `import { client } from '@/api/client';`

(b) 删除 `shareSrc`，换成：

```ts
function cardVariant(media: Pick<MomentMedia, 'derivedUrl'>): 'original' | 'derived' {
  return media.derivedUrl ? 'derived' : 'original';
}

function posterVariant(media: Pick<MomentMedia, 'posterDerivedUrl'>): 'original' | 'derived' {
  return media.posterDerivedUrl ? 'derived' : 'original';
}

function shareSrc(mediaId: string, shareToken: string, variant?: 'original' | 'derived'): string {
  return client.mediaUrl(mediaId, {
    variant: variant === 'derived' ? 'derived' : undefined,
    st: shareToken,
  });
}
```

(c) `ImageOne` 内：

```ts
  const variant = cardVariant(media);
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id, {
    variant,
    fallbackToOriginal: variant === 'derived',
  });
  const url = shareToken ? shareSrc(media.id, shareToken, variant) : blobUrl;
```

(d) `VideoOne` 播放面封面：

```ts
  const blobUrl = useMediaObjectUrl(!shareToken && on ? media.id : null, {
    variant: 'original',
    fallbackToOriginal: false,
  });
  const pVariant = posterVariant(media);
  const posterBlobUrl = useMediaObjectUrl(!shareToken && !on ? media.posterMediaId : null, {
    variant: pVariant,
    fallbackToOriginal: pVariant === 'derived',
  });
  const url = shareToken ? shareSrc(media.id, shareToken) : blobUrl;
```

分享 `<video poster>`：

```ts
      poster={
        shareToken && media.posterMediaId
          ? shareSrc(media.posterMediaId, shareToken, pVariant)
          : undefined
      }
```

文件头注释把「`${m.url}?st=`」改成「分享走 `client.mediaUrl`（已有 `?` 则 `&st=`）」。

Modify `apps/web/src/timeline/lightbox.tsx`：

- import `client`
- `LightboxMedia`：

```ts
  const blobUrl = useMediaObjectUrl(shareToken ? null : media.id);
  const url = shareToken ? client.mediaUrl(media.id, { st: shareToken }) : blobUrl;
```

不传 derived。

Modify `apps/web/src/media/AudioBar.tsx`：

- import `client`
- `const url = shareToken ? client.mediaUrl(media.id, { st: shareToken }) : blobUrl;`

- [ ] **Step 4: 运行确认通过**

Run:
```
pnpm --filter @moment/web test -- src/media/MediaBlock.test.tsx
pnpm --filter @moment/web test -- src/timeline/lightbox.test.tsx
```
Expected: PASS。分享 derived src 含 `variant=derived&st=`；Lightbox 无 derived 调用；无 derived 的分享图仍 `?st=tok%20en`。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/media/MediaBlock.tsx apps/web/src/media/MediaBlock.test.tsx apps/web/src/timeline/lightbox.tsx apps/web/src/timeline/lightbox.test.tsx apps/web/src/media/AudioBar.tsx
git commit -m "feat(web): use derived images on cards and safe share query tokens"
```

---

### Task 4: `RailFilter` + `feedQuery` + 页面 Service 把 `personId`/`place` 送进 GET（不含搜索 UI）

**Files:**
- Modify: `apps/web/src/timeline/timeline-rail.tsx`（只改 `RailFilter` 类型，Rail UI 不加人名词典）
- Modify: `apps/web/src/lib/feed.ts`
- Create: `apps/web/src/lib/feed.test.ts`
- Modify: `apps/web/src/pages/feed-home/feed-home.service.ts`
- Create: `apps/web/src/pages/feed-home/feed-home.service.test.ts`
- Modify: `apps/web/src/pages/chain-home/chain-home.service.ts`
- Create: `apps/web/src/pages/chain-home/chain-home.service.test.ts`

**Interfaces:**
- Consumes: Task 1 `FeedQuery.personId` / `place`；既有 `client.getFeed` / `feedQuery` / `RailFilter.{ chainIds, tagId, order, before }`
- Produces:
  - `RailFilter.personId?: string`
  - `RailFilter.personName?: string`（展示用，不进 HTTP）
  - `RailFilter.place?: string`
  - `feedQuery(filter)` 产出 `{ personId: filter.personId, place: filter.place, ... }`，**永不**带 `personName` / `happenedFrom`（chip UI 不用区间；日历仍是 `before`）
  - `FeedHomeService.filtered` / `ChainHomeService.filtered` 为 true 当 `personId` 或 `place` 有值
  - `togglePersonFilter({ id, name })`：同一 id 再点清除；否则单选写入 `personId`+`personName`
  - `togglePlaceFilter(place: string)`：同一 place 再点清除
  - `clearFilters` 去掉 person/place（chain-home 仍强制 `chainIds:[chainId]`）
  - `loadMeta` 的 `getMonthIndex` **不**传 personId/place（spec §6.1）
  - 本 Task **不**改 chip 的 span、不改搜索、不改页面 JSX

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/lib/feed.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { feedQuery } from './feed';
import type { RailFilter } from '@/timeline/timeline-rail';

describe('feedQuery（spec fused-retrieval §7.1）', () => {
  it('带出 personId/place，不带 personName', () => {
    const filter: RailFilter = {
      order: 'happened_at',
      personId: 'p-1',
      personName: '外婆',
      place: '朝阳公园',
      tagId: 't-1',
      before: '2026-09-01T00:00:00.000Z',
      chainIds: ['c-1'],
    };
    const q = feedQuery(filter, 'cur', 50);
    expect(q).toEqual({
      chainIds: ['c-1'],
      tagId: 't-1',
      order: 'happened_at',
      before: '2026-09-01T00:00:00.000Z',
      personId: 'p-1',
      place: '朝阳公园',
      cursor: 'cur',
      limit: 50,
    });
    expect(q).not.toHaveProperty('personName');
    expect(q).not.toHaveProperty('happenedFrom');
    expect(q).not.toHaveProperty('happenedTo');
  });
});
```

Create `apps/web/src/pages/feed-home/feed-home.service.test.ts`：

```ts
import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedHomeService } from './feed-home.service';

const emptyPage = { moments: [], nextCursor: null };

const api = vi.hoisted(() => ({
  getFeed: vi.fn().mockResolvedValue({ moments: [], nextCursor: null }),
  getMonthIndex: vi.fn().mockResolvedValue({ months: [] }),
  listTags: vi.fn().mockResolvedValue({ tags: [] }),
  searchMoments: vi.fn().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  }),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(FeedHomeService);

beforeEach(() => {
  api.getFeed.mockReset().mockResolvedValue(emptyPage);
  api.getMonthIndex.mockReset().mockResolvedValue({ months: [] });
  api.listTags.mockReset().mockResolvedValue({ tags: [] });
  const s = resolve(FeedHomeService);
  s.filter = { order: 'happened_at' };
  s.moments = [];
  s.nextCursor = null;
});

describe('FeedHomeService chip 过滤', () => {
  it('togglePersonFilter 单选；再点同一人清除；getFeed 带 personId 不带 personName', async () => {
    const s = resolve(FeedHomeService);
    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    expect(s.filter.personId).toBe('p-1');
    expect(s.filter.personName).toBe('外婆');
    expect(s.filtered).toBe(true);
    expect(api.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p-1', place: undefined, limit: 50 }),
    );
    const sent = api.getFeed.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('personName');

    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    expect(s.filter.personId).toBeUndefined();
    expect(s.filtered).toBe(false);

    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    await s.togglePersonFilter({ id: 'p-2', name: '爸爸' });
    expect(s.filter.personId).toBe('p-2');
    expect(s.filter.personName).toBe('爸爸');
  });

  it('togglePlaceFilter 等值；clearFilters 清掉人/地', async () => {
    const s = resolve(FeedHomeService);
    await s.togglePlaceFilter('朝阳公园');
    expect(s.filter.place).toBe('朝阳公园');
    await s.togglePlaceFilter('朝阳公园');
    expect(s.filter.place).toBeUndefined();
    await s.togglePlaceFilter('朝阳公园');
    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    s.clearFilters();
    expect(s.filter).toEqual({ order: 'happened_at' });
  });

  it('loadMeta 的 month-index 不带 personId/place', async () => {
    const s = resolve(FeedHomeService);
    s.filter = { order: 'happened_at', personId: 'p-1', place: '朝阳公园' };
    await s.loadMeta();
    expect(api.getMonthIndex).toHaveBeenCalledWith(
      expect.objectContaining({ chainIds: undefined, tagId: undefined }),
    );
    const arg = api.getMonthIndex.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('personId');
    expect(arg).not.toHaveProperty('place');
  });
});
```

Create `apps/web/src/pages/chain-home/chain-home.service.test.ts`：

```ts
import { register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainHomeService } from './chain-home.service';

const api = vi.hoisted(() => ({
  getFeed: vi.fn().mockResolvedValue({ moments: [], nextCursor: null }),
  getMonthIndex: vi.fn().mockResolvedValue({ months: [] }),
  listTags: vi.fn().mockResolvedValue({ tags: [] }),
  getChain: vi.fn().mockResolvedValue({ id: 'c-1', myRole: 'owner', templateManifest: { version: 1 } }),
  searchMoments: vi.fn().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  }),
}));

vi.mock('@/api/client', () => ({ client: api }));

register(ChainHomeService);

beforeEach(() => {
  api.getFeed.mockReset().mockResolvedValue({ moments: [], nextCursor: null });
  api.getMonthIndex.mockReset().mockResolvedValue({ months: [] });
  api.listTags.mockReset().mockResolvedValue({ tags: [] });
  api.getChain.mockReset().mockResolvedValue({ id: 'c-1', myRole: 'owner', templateManifest: { version: 1 } });
  const s = resolve(ChainHomeService);
  s.chainId = 'c-1';
  s.filter = { order: 'happened_at', chainIds: ['c-1'] };
  s.moments = [];
  s.nextCursor = null;
});

describe('ChainHomeService chip 过滤', () => {
  it('setFilter 恒带 chainIds:[chainId]；togglePersonFilter 后 getFeed 含 personId', async () => {
    const s = resolve(ChainHomeService);
    await s.togglePersonFilter({ id: 'p-1', name: '外婆' });
    expect(s.filter.chainIds).toEqual(['c-1']);
    expect(api.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ chainIds: ['c-1'], personId: 'p-1', limit: 50 }),
    );
  });

  it('filtered 在仅 personId 时为 true；clearFilters 保留本链 chainIds', () => {
    const s = resolve(ChainHomeService);
    s.filter = { order: 'happened_at', chainIds: ['c-1'], personId: 'p-1', personName: '外婆' };
    expect(s.filtered).toBe(true);
    s.clearFilters();
    expect(s.filter).toEqual({ order: 'happened_at', chainIds: ['c-1'] });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run:
```
pnpm --filter @moment/web test -- src/lib/feed.test.ts
pnpm --filter @moment/web test -- src/pages/feed-home/feed-home.service.test.ts
pnpm --filter @moment/web test -- src/pages/chain-home/chain-home.service.test.ts
```
Expected: FAIL——`RailFilter` 无 `personId` 类型 / `feedQuery` 不带出 / `togglePersonFilter is not a function`。

- [ ] **Step 3: 最小实现**

Modify `apps/web/src/timeline/timeline-rail.tsx` 的 `RailFilter`：

```ts
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
```

Rail 内部 `onChange({ ...value, tagId })` 已展开 `value`，人/地会随 tag/月份跳转保留。不要在轨上新增人物词典 UI。

Modify `apps/web/src/lib/feed.ts`：

```ts
export function feedQuery(filter: RailFilter, cursor?: string, limit = 50): FeedQueryInput {
  return {
    chainIds: filter.chainIds,
    tagId: filter.tagId,
    order: filter.order,
    before: filter.before,
    personId: filter.personId,
    place: filter.place,
    cursor,
    limit,
  };
}
```

Modify `apps/web/src/pages/feed-home/feed-home.service.ts`：

`filtered` getter：

```ts
  get filtered(): boolean {
    return Boolean(
      this.filter.tagId ||
        this.filter.chainIds?.length ||
        this.filter.order === 'created_at' ||
        this.filter.before ||
        this.filter.personId ||
        this.filter.place,
    );
  }
```

在 `clearFilters` 之后追加：

```ts
  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.filter.personId === person.id) {
      this.setFilter({ ...this.filter, personId: undefined, personName: undefined });
      return;
    }
    this.setFilter({ ...this.filter, personId: person.id, personName: person.name });
  }

  togglePlaceFilter(place: string): void {
    this.setFilter({
      ...this.filter,
      place: this.filter.place === place ? undefined : place,
    });
  }
```

`loadMeta` 保持只传 `chainIds`/`tagId`/`tzOffset`。

Modify `apps/web/src/pages/chain-home/chain-home.service.ts`：

`filtered` getter（**不要**把恒在的 `chainIds` 算进 filtered，否则链页永远是筛选空态）：

```ts
  get filtered(): boolean {
    return Boolean(
      this.filter.tagId || this.filter.order === 'created_at' || this.filter.before || this.filter.personId || this.filter.place,
    );
  }
```

`clearFilters` 之后追加（必须走 `setFilter`，从而恒带 `chainIds:[this.chainId]`）：

```ts
  togglePersonFilter(person: { id: string; name: string }): void {
    if (this.filter.personId === person.id) {
      this.setFilter({ ...this.filter, personId: undefined, personName: undefined });
      return;
    }
    this.setFilter({ ...this.filter, personId: person.id, personName: person.name });
  }

  togglePlaceFilter(place: string): void {
    this.setFilter({
      ...this.filter,
      place: this.filter.place === place ? undefined : place,
    });
  }
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 三条命令
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/timeline/timeline-rail.tsx apps/web/src/lib/feed.ts apps/web/src/lib/feed.test.ts apps/web/src/pages/feed-home/feed-home.service.ts apps/web/src/pages/feed-home/feed-home.service.test.ts apps/web/src/pages/chain-home/chain-home.service.ts apps/web/src/pages/chain-home/chain-home.service.test.ts
git commit -m "feat(web): pass personId and place through rail filters to feed"
```

---

### Task 5: 链内人物/地点 chip 可点 + 列表顶清除 chip（分享不可点）

**Files:**
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/timeline/moment-sheet-people-place.test.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`
- Create: `apps/web/src/timeline/filter-chips.tsx`
- Create: `apps/web/src/timeline/filter-chips.test.tsx`
- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`

**Interfaces:**
- Consumes: Task 4 `togglePersonFilter` / `togglePlaceFilter` / `RailFilter.personName`；既有 chip 视觉 `rounded-full border border-line px-3 py-1 text-caption`
- Produces:
  - `MomentSheetContent` 可选 `onPersonFilter?: (person: { id: string; name: string }) => void`、`onPlaceFilter?: (place: string) => void`
  - 传入回调 → `<button type="button">` + `focus-visible:ring-focus` + AI 角标保留；不传 → 现网 `<span>`（分享 / 详情）
  - `Timeline` 同步可选两回调，`readOnly` 时不往 sheet 传
  - `<FilterChips filter onClearPerson onClearPlace onClearBefore />`：有 `before`/`personId`/`place` 才渲染；文案「回到今天」「{personName} ×」「📍 {place} ×」
  - feed-home / chain-home（timeline tab）接 FilterChips，去掉各自重复的「回到今天」块

- [ ] **Step 1: 写失败测试**

Modify `apps/web/src/timeline/moment-sheet-people-place.test.tsx` — 在既有三个用例之后追加（既有「只读 span / queryByRole button 为 null」必须继续绿——那些用例不传回调）：

```tsx
  it('传入 onPersonFilter/onPlaceFilter：chip 是 button，再点回调；AI 角标仍在', async () => {
    const user = userEvent.setup();
    const onPersonFilter = vi.fn();
    const onPlaceFilter = vi.fn();
    render(
      <RSRoot>
        <MomentSheetContent
          readOnly
          moment={moment({
            persons: [
              { id: 'p-1', name: '爸爸', userId: 'u-1', source: 'manual' },
              { id: 'p-2', name: '外婆', userId: null, source: 'ai' },
            ],
            place: { lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' },
          })}
          onPersonFilter={onPersonFilter}
          onPlaceFilter={onPlaceFilter}
        />
      </RSRoot>,
    );
    const group = screen.getByLabelText('和谁在一起');
    expect(within(group).getByRole('button', { name: '筛选 外婆' })).toBeInTheDocument();
    expect(within(group).getByText('AI')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: '筛选 外婆' }));
    expect(onPersonFilter).toHaveBeenCalledWith({ id: 'p-2', name: '外婆' });
    await user.click(screen.getByRole('button', { name: '筛选地点 外婆家' }));
    expect(onPlaceFilter).toHaveBeenCalledWith('外婆家');
  });
```

在该文件顶部 import 增加 `import userEvent from '@testing-library/user-event';`。

Create `apps/web/src/timeline/filter-chips.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterChips } from './filter-chips';

describe('FilterChips（spec §7.1 列表顶清除 chip）', () => {
  it('无人/地/before 不渲染', () => {
    const { container } = render(
      <FilterChips
        filter={{ order: 'happened_at' }}
        onClearPerson={() => undefined}
        onClearPlace={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('渲染「外婆 ×」「📍 朝阳公园 ×」，点击清除', async () => {
    const user = userEvent.setup();
    const onClearPerson = vi.fn();
    const onClearPlace = vi.fn();
    render(
      <FilterChips
        filter={{
          order: 'happened_at',
          personId: 'p-1',
          personName: '外婆',
          place: '朝阳公园',
        }}
        onClearPerson={onClearPerson}
        onClearPlace={onClearPlace}
      />,
    );
    await user.click(screen.getByRole('button', { name: '清除人物筛选 外婆' }));
    expect(onClearPerson).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '清除地点筛选 朝阳公园' }));
    expect(onClearPlace).toHaveBeenCalledTimes(1);
    expect(screen.getByText('外婆 ×')).toBeInTheDocument();
    expect(screen.getByText('📍 朝阳公园 ×')).toBeInTheDocument();
  });

  it('before 时渲染「回到今天」', async () => {
    const user = userEvent.setup();
    const onClearBefore = vi.fn();
    render(
      <FilterChips
        filter={{ order: 'happened_at', before: '2026-09-01T00:00:00.000Z' }}
        onClearPerson={() => undefined}
        onClearPlace={() => undefined}
        onClearBefore={onClearBefore}
      />,
    );
    await user.click(screen.getByRole('button', { name: '回到今天' }));
    expect(onClearBefore).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run:
```
pnpm --filter @moment/web test -- src/timeline/moment-sheet-people-place.test.tsx
pnpm --filter @moment/web test -- src/timeline/filter-chips.test.tsx
```
Expected: FAIL——找不到 `筛选 外婆` button / 无法 resolve `./filter-chips`。既有「只读 span」用例仍应 PASS。

- [ ] **Step 3: 最小实现**

Create `apps/web/src/timeline/filter-chips.tsx`：

```tsx
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/ui/button/index';
import type { RailFilter } from './timeline-rail';

const chip =
  'rounded-full border border-line px-3 py-1 text-caption text-ink transition-colors duration-[var(--ease)] hover:bg-floating-hover focus-visible:outline-none focus-visible:ring-focus';

export function FilterChips({
  filter,
  onClearPerson,
  onClearPlace,
  onClearBefore,
}: {
  filter: RailFilter;
  onClearPerson: () => void;
  onClearPlace: () => void;
  onClearBefore?: () => void;
}) {
  const hasBefore = Boolean(filter.before);
  const hasPerson = Boolean(filter.personId);
  const hasPlace = Boolean(filter.place);
  if (!hasBefore && !hasPerson && !hasPlace) return null;
  return (
    <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2">
      {hasBefore && onClearBefore ? (
        <Button variant="secondary" leadingIcon={ArrowLeft} onClick={onClearBefore}>
          回到今天
        </Button>
      ) : null}
      {hasPerson ? (
        <button
          type="button"
          aria-label={`清除人物筛选 ${filter.personName ?? '人物'}`}
          onClick={onClearPerson}
          className={chip}
        >
          {filter.personName ?? '人物'} ×
        </button>
      ) : null}
      {hasPlace ? (
        <button
          type="button"
          aria-label={`清除地点筛选 ${filter.place}`}
          onClick={onClearPlace}
          className={chip}
        >
          📍 {filter.place} ×
        </button>
      ) : null}
    </div>
  );
}
```

Modify `apps/web/src/timeline/moment-sheet.tsx`：

`MomentSheetContent` props 增加：

```ts
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
```

把人物/地点展示块换成（类名保持与现网 span 同形，仅 button 多 `focus-visible`）：

```tsx
        {moment.persons && moment.persons.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2" aria-label="和谁在一起">
            {moment.persons.map((p) => {
              const inner = (
                <>
                  {p.name}
                  {p.source === 'ai' && <span className="ml-1 text-muted">AI</span>}
                </>
              );
              const className =
                'rounded-full border border-line px-3 py-1 text-caption text-ink focus-visible:outline-none focus-visible:ring-focus';
              return onPersonFilter ? (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`筛选 ${p.name}`}
                  className={className}
                  onClick={() => onPersonFilter({ id: p.id, name: p.name })}
                >
                  {inner}
                </button>
              ) : (
                <span key={p.id} className={className}>
                  {inner}
                </span>
              );
            })}
          </div>
        )}
        {moment.place?.name &&
          (onPlaceFilter ? (
            <button
              type="button"
              aria-label={`筛选地点 ${moment.place.name}`}
              onClick={() => onPlaceFilter(moment.place!.name!)}
              className="mt-1 text-left text-meta text-muted focus-visible:outline-none focus-visible:ring-focus"
            >
              📍 {moment.place.name}
            </button>
          ) : (
            <p className="mt-1 text-meta text-muted">📍 {moment.place.name}</p>
          ))}
```

更新该块注释：链内时间线可点；分享/详情不传回调则 span。

Modify `apps/web/src/timeline/timeline.tsx` — 在参数表与 props 类型都加两回调（`ageLabelOf` 之后），`renderSheet` 的 `<MomentSheet` 传入。`readOnly` 时剥掉回调（分享页）；链内页传回调。chip 变 button 的开关是 **回调是否存在**，不是 `readOnly` 本身：

在既有 `ageLabelOf` 参数后追加（既有 props 一字不删）：

```tsx
  onPersonFilter,
  onPlaceFilter,
}: {
  onPersonFilter?: (person: { id: string; name: string }) => void;
  onPlaceFilter?: (place: string) => void;
}) {
```

```tsx
        onPersonFilter={readOnly ? undefined : onPersonFilter}
        onPlaceFilter={readOnly ? undefined : onPlaceFilter}
```

Modify `apps/web/src/pages/feed-home/index.tsx`：

- import `FilterChips`
- 删除 `{service.filter.before && ( <div className="sticky...回到今天` 整块
- 在 `<Timeline` 之前插入：

```tsx
      <FilterChips
        filter={service.filter}
        onClearPerson={() =>
          service.setFilter({ ...service.filter, personId: undefined, personName: undefined })
        }
        onClearPlace={() => service.setFilter({ ...service.filter, place: undefined })}
        onClearBefore={() => service.clearBefore()}
      />
```

- `<Timeline` 增加：

```tsx
        onPersonFilter={(p) => service.togglePersonFilter(p)}
        onPlaceFilter={(place) => service.togglePlaceFilter(place)}
```

Modify `apps/web/src/pages/chain-home/index.tsx`：

- import `FilterChips`
- 删除 `{service.filter.before && ( <div className="sticky...回到今天` 整块（它现在在 tab 之外，挪进 timeline 分支以免聚合/地图叠一条 sticky）
- 在 `service.activeView === 'timeline'` 的 `<Timeline` **之前**插入（非 timeline tab 不插）：

```tsx
        <FilterChips
          filter={service.filter}
          onClearPerson={() =>
            service.setFilter({ ...service.filter, personId: undefined, personName: undefined })
          }
          onClearPlace={() => service.setFilter({ ...service.filter, place: undefined })}
          onClearBefore={() => service.clearBefore()}
        />
```

- 该 `<Timeline` 增加：

```tsx
          onPersonFilter={(p) => service.togglePersonFilter(p)}
          onPlaceFilter={(place) => service.togglePlaceFilter(place)}
```

- [ ] **Step 4: 运行确认通过**

Run:
```
pnpm --filter @moment/web test -- src/timeline/moment-sheet-people-place.test.tsx
pnpm --filter @moment/web test -- src/timeline/filter-chips.test.tsx
pnpm --filter @moment/web test -- src/pages/chain-home/chain-home.test.tsx
pnpm --filter @moment/web test -- src/pages/timeline-variants.test.tsx
```
Expected: PASS。分享变体仍无人物按钮；链主页「回到今天」若有 before 锚定用例仍找得到该 button。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/moment-sheet-people-place.test.tsx apps/web/src/timeline/timeline.tsx apps/web/src/timeline/filter-chips.tsx apps/web/src/timeline/filter-chips.test.tsx apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/chain-home/index.tsx
git commit -m "feat(web): click person and place chips to filter the timeline"
```

---

### Task 6: 主列 `TextField type=search` → `POST /api/search`；可关闭 parsed 摘要；不带 `before`

**Files:**
- Create: `apps/web/src/lib/search-summary.ts`
- Create: `apps/web/src/lib/search-summary.test.ts`
- Create: `apps/web/src/timeline/search-field.tsx`
- Create: `apps/web/src/timeline/search-field.test.tsx`
- Modify: `apps/web/src/pages/feed-home/feed-home.service.ts`
- Modify: `apps/web/src/pages/feed-home/feed-home.service.test.ts`
- Modify: `apps/web/src/pages/chain-home/chain-home.service.ts`
- Modify: `apps/web/src/pages/chain-home/chain-home.service.test.ts`
- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`

**Interfaces:**
- Consumes:
  - Task 1 `client.searchMoments` / dto `SearchInput` / `SearchParsed` / `INTENT_MAX_QUERY_CHARS` / `SEARCH_MAX_LIMIT`
  - Task 4 `filter.personId` / `tagId` / `place`；`currentTzOffset()`
  - 既有 `TextField`（`apps/web/src/ui/field/Field.tsx` `type?: ... | 'search'`，`isClearable`）
  - 既有 `Banner` / `EmptyState` / `humanError`（`RATE_LIMITED` 已有文案）
- Produces:
  - `formatSearchParsed(parsed: SearchParsed): string`
  - `<TimelineSearchField onSubmit onClear />` — **不是** SearchBar；内部只有 `TextField type="search"`
  - `FeedHomeService` / `ChainHomeService`：`searching: boolean`、`searchQ: string`、`searchParsed: SearchParsed | null`、`searchError: unknown`、`submitSearch(q: string): Promise<void>`、`exitSearch(): Promise<void>`
  - `loadFirst`/`loadMore` 在 `searching` 时走 `searchMoments`：body 含 `q`、`tzOffset`、`chainIds`、`limit: SEARCH_MAX_LIMIT`、`cursor?`、以及当前 `personId`/`tagId`/`place`；**对象字面量不出现 `before`/`order`/`source`**
  - 关闭摘要 / 清空搜索框 → `exitSearch` → 再 `getFeed`（恢复 `{h,i}` GET）
  - 429：`searchError` + Banner `humanError`，不 Toast，不覆盖已有 `moments`
  - 搜索空态 EmptyState title「没有找到相关时刻」，action「退出搜索」
  - 链主页仅 `activeView==='timeline'` 渲染搜索框；分享页不加

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/lib/search-summary.test.ts`：

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

  it('降级 parsed（仅 text=q）不额外提示模型失败', () => {
    const parsed: SearchParsed = { personNames: [], place: null, time: null, text: '去年今天和外婆' };
    expect(formatSearchParsed(parsed)).toBe('找到：去年今天和外婆');
  });
});
```

Create `apps/web/src/timeline/search-field.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TimelineSearchField } from './search-field';

describe('TimelineSearchField（Field type=search，不是 SearchBar）', () => {
  it('可见 Label「搜索时刻」+ placeholder；提交 trim 后的 q', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TimelineSearchField onSubmit={onSubmit} onClear={() => undefined} />);
    expect(screen.getByLabelText('搜索时刻')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索时刻，例如 去年今天和外婆')).toBeInTheDocument();
    await user.type(screen.getByLabelText('搜索时刻'), '  外婆  ');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('外婆');
  });

  it('isClearable 清空调用 onClear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<TimelineSearchField onSubmit={() => undefined} onClear={onClear} />);
    await user.type(screen.getByLabelText('搜索时刻'), '外婆');
    await user.click(screen.getByRole('button', { name: '清除' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('提交时截断到 INTENT_MAX_QUERY_CHARS（不设 maxLength，避免 0/500 计数）', () => {
    const onSubmit = vi.fn();
    render(<TimelineSearchField onSubmit={onSubmit} onClear={() => undefined} />);
    const input = screen.getByLabelText('搜索时刻');
    fireEvent.change(input, { target: { value: 'x'.repeat(501) } });
    fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('x'.repeat(500));
  });
});
```

Modify `apps/web/src/pages/feed-home/feed-home.service.test.ts` — 在 `beforeEach` 里加（T4 的 `s.searching = false` 四行若尚未写则一并加上；`searchMoments` 的 mockReset 必写）：

```ts
  api.searchMoments.mockReset().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  });
```

**本 Task 落地搜索字段后**，在同一 `beforeEach` 的 `s.nextCursor = null` 之后补：

```ts
  s.searching = false;
  s.searchQ = '';
  s.searchParsed = null;
  s.searchError = null;
```

（T4 执行时还没有这四字段，不要提前写进 T4 的测试，否则 typecheck 红。）

并追加 describe：

```ts
describe('FeedHomeService 搜索（spec §7.2）', () => {
  it('submitSearch POST searchMoments：带 personId/tagId/place，不带 before', async () => {
    const s = resolve(FeedHomeService);
    s.filter = {
      order: 'happened_at',
      personId: 'p-1',
      personName: '外婆',
      tagId: 't-1',
      place: '朝阳公园',
      before: '2026-09-01T00:00:00.000Z',
      chainIds: ['c-1'],
    };
    api.searchMoments.mockResolvedValueOnce({
      moments: [{ id: 'm-hit' }],
      nextCursor: 'next',
      parsed: { personNames: ['外婆'], place: null, time: null, text: '' },
    });
    await s.submitSearch('去年今天和外婆');
    expect(s.searching).toBe(true);
    expect(s.moments).toEqual([{ id: 'm-hit' }]);
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    expect(api.searchMoments).toHaveBeenCalledTimes(1);
    const body = api.searchMoments.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.q).toBe('去年今天和外婆');
    expect(body.personId).toBe('p-1');
    expect(body.tagId).toBe('t-1');
    expect(body.place).toBe('朝阳公园');
    expect(body.chainIds).toEqual(['c-1']);
    expect(body.limit).toBe(50);
    expect(typeof body.tzOffset).toBe('number');
    expect(body).not.toHaveProperty('before');
    expect(body).not.toHaveProperty('order');
    expect(body).not.toHaveProperty('source');
  });

  it('loadMore 在 searching 时继续 POST + cursor，不带 before，不改 searchParsed', async () => {
    const s = resolve(FeedHomeService);
    api.searchMoments
      .mockResolvedValueOnce({
        moments: [{ id: 'm-1' }],
        nextCursor: 's-cur',
        parsed: { personNames: ['外婆'], place: null, time: null, text: '' },
      })
      .mockResolvedValueOnce({
        moments: [{ id: 'm-2' }],
        nextCursor: null,
        parsed: { personNames: [], place: null, time: null, text: '漂移' },
      });
    await s.submitSearch('外婆');
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    await s.loadMore();
    expect(s.moments.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(s.searchParsed?.personNames).toEqual(['外婆']);
    expect(api.searchMoments).toHaveBeenCalledTimes(2);
    const more = api.searchMoments.mock.calls[1]![0] as Record<string, unknown>;
    expect(more.q).toBe('外婆');
    expect(more.cursor).toBe('s-cur');
    expect(more).not.toHaveProperty('before');
    expect(more).not.toHaveProperty('parsed');
  });

  it('exitSearch 清搜索游标并改回 getFeed', async () => {
    const s = resolve(FeedHomeService);
    api.searchMoments.mockResolvedValueOnce({
      moments: [{ id: 'm-hit' }],
      nextCursor: 's-cur',
      parsed: { personNames: [], place: null, time: null, text: 'q' },
    });
    await s.submitSearch('外婆');
    api.getFeed.mockClear();
    await s.exitSearch();
    expect(s.searching).toBe(false);
    expect(s.searchParsed).toBeNull();
    expect(api.getFeed).toHaveBeenCalled();
    expect(api.searchMoments).toHaveBeenCalledTimes(1);
  });

  it('搜索 429 写入 searchError，不覆盖 moments，不调用 toast', async () => {
    const { ApiError } = await import('@moment/api-client');
    const s = resolve(FeedHomeService);
    s.moments = [{ id: 'keep' } as never];
    api.searchMoments.mockRejectedValueOnce(new ApiError('RATE_LIMITED', 429, 'RATE_LIMITED'));
    await s.submitSearch('外婆');
    expect(s.moments).toEqual([{ id: 'keep' }]);
    expect(s.searchError).toBeInstanceOf(ApiError);
    expect((s.searchError as { code: string }).code).toBe('RATE_LIMITED');
  });
});
```

Modify `apps/web/src/pages/chain-home/chain-home.service.test.ts` 追加：

```ts
  it('链页搜索 chainIds 恒为 [chainId]，忽略轨上其它链', async () => {
    const s = resolve(ChainHomeService);
    api.searchMoments.mockResolvedValueOnce({
      moments: [],
      nextCursor: null,
      parsed: { personNames: [], place: null, time: null, text: '外婆' },
    });
    await s.submitSearch('外婆');
    expect(api.searchMoments.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ q: '外婆', chainIds: ['c-1'] }),
    );
    const body = api.searchMoments.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('before');
  });
```

该文件 `beforeEach` 同样：

```ts
  api.searchMoments.mockReset().mockResolvedValue({
    moments: [],
    nextCursor: null,
    parsed: { personNames: [], place: null, time: null, text: '' },
  });
  s.searching = false;
  s.searchQ = '';
  s.searchParsed = null;
  s.searchError = null;
```

- [ ] **Step 2: 运行确认失败**

Run:
```
pnpm --filter @moment/web test -- src/lib/search-summary.test.ts
pnpm --filter @moment/web test -- src/timeline/search-field.test.tsx
pnpm --filter @moment/web test -- src/pages/feed-home/feed-home.service.test.ts
pnpm --filter @moment/web test -- src/pages/chain-home/chain-home.service.test.ts
```
Expected: FAIL——`formatSearchParsed` / `TimelineSearchField` 模块不存在；`submitSearch is not a function`。

- [ ] **Step 3: 最小实现**

Create `apps/web/src/lib/search-summary.ts`：

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

Create `apps/web/src/timeline/search-field.tsx`：

```tsx
import { useState, type FormEvent } from 'react';
import { INTENT_MAX_QUERY_CHARS } from '@moment/dto';
import { TextField } from '@/ui/field/index';

/** 时间线搜索：复用 Field type=search，不是新的 SearchBar 设计组件。 */
export function TimelineSearchField({
  onSubmit,
  onClear,
}: {
  onSubmit: (q: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <form className="mb-4" onSubmit={handleSubmit}>
      <TextField
        label="搜索时刻"
        name="timeline-search"
        type="search"
        enterKeyHint="search"
        isClearable
        placeholder="搜索时刻，例如 去年今天和外婆"
        value={q}
        onChange={(next) => {
          setQ(next);
          if (next === '') onClear();
        }}
      />
    </form>
  );
}
```

Modify `feed-home.service.ts` 与 `chain-home.service.ts`。字段与 `submitSearch`/`exitSearch` 两文件逐字相同。差别只在 `searchMoments` 的 `chainIds`：feed-home 用 `this.filter.chainIds`，chain-home 用 `[this.chainId]`（且 `loadFirst` 开头保留 `if (!this.chainId) return`）。

在 class 字段区追加：

```ts
  searching = false;
  searchQ = '';
  searchParsed: SearchParsed | null = null;
  searchError: unknown = null;
```

（`SearchParsed` from `@moment/dto`）

追加方法：

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

`loadFirst` 在 `const gen = ++this.gen;` 之后包 try/catch。feed-home 的搜索分支如下（chain-home 把其中 `chainIds: this.filter.chainIds` 换成 `chainIds: [this.chainId]`）：

```ts
    try {
      if (this.searching) {
        const page = await client.searchMoments({
          q: this.searchQ,
          chainIds: this.filter.chainIds,
          tzOffset: currentTzOffset(),
          limit: SEARCH_MAX_LIMIT,
          personId: this.filter.personId,
          tagId: this.filter.tagId,
          place: this.filter.place,
        });
        if (gen !== this.gen) return;
        this.moments = page.moments;
        this.nextCursor = page.nextCursor ?? null;
        this.searchParsed = page.parsed;
        this.searchError = null;
        return;
      }
      const page = await client.getFeed(feedQuery(this.filter, undefined, 50));
      if (gen !== this.gen) return;
      this.moments = page.moments;
      this.nextCursor = page.nextCursor ?? null;
    } catch (err) {
      if (gen !== this.gen) return;
      if (this.searching) this.searchError = err;
      else throw err;
    }
```

注意：非搜索路径的 throw 保留给 `$model.loadFirst.error`（既有 Banner「没法刷新」）。搜索路径吞进 `searchError`，避免和 GET 错误通道搅在一起。

`loadMore`：feed-home 在既有 `getFeed(feedQuery(...))` 外包一层 `this.searching` 三元：

```ts
      const page = this.searching
        ? await client.searchMoments({
            q: this.searchQ,
            chainIds: this.filter.chainIds,
            tzOffset: currentTzOffset(),
            cursor: this.nextCursor ?? undefined,
            limit: SEARCH_MAX_LIMIT,
            personId: this.filter.personId,
            tagId: this.filter.tagId,
            place: this.filter.place,
          })
        : await client.getFeed(feedQuery(this.filter, this.nextCursor, 50));
```

chain-home 的搜索分支把 `chainIds: this.filter.chainIds` 换成 `chainIds: [this.chainId]`，GET 分支仍是 `feedQuery(this.filter, this.nextCursor, 50)`。

搜索 `loadMore` 成功后**不要**改 `searchParsed`（首页摘要已展示；后一页 parsed 覆盖会闪）。

两文件都 `import { SEARCH_MAX_LIMIT, type SearchParsed } from '@moment/dto';`。

Modify `apps/web/src/pages/feed-home/index.tsx`：

- import `TimelineSearchField`、`formatSearchParsed`、`Banner`
- 在 `TimelineRail` **之前**插入搜索框（主列顶部、入口条/那年今日之后）：

```tsx
      <TimelineSearchField
        onSubmit={(q) => void service.submitSearch(q)}
        onClear={() => {
          if (service.searching) void service.exitSearch();
        }}
      />
```

- FilterChips 之前：

```tsx
      {service.searchError ? (
        <Banner tone="error">{humanError(service.searchError)}</Banner>
      ) : service.searching && service.searchParsed ? (
        <Banner tone="info" action={{ label: '关闭', onPress: () => void service.exitSearch() }}>
          {formatSearchParsed(service.searchParsed)}
        </Banner>
      ) : null}
```

（同一区域最多一个 Banner：有 `searchError` 就不展示 parsed。）

- `empty` 三元改成 `noChains` → `searching` → `filtered` → 默认（搜索空态必须在 `filtered` 之前，避免「清除筛选」误退出搜索）：

```tsx
          noChains ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="建第一条时光链，比如「宝宝成长」"
              description="点「开一条新的链」就可以。"
            />
          ) : service.searching ? (
            <EmptyState
              variant="timeline"
              scope="section"
              title="没有找到相关时刻"
              description="换个说法，或关掉搜索回到时间线。"
              action={{ label: '退出搜索', emphasis: 'quiet', onPress: () => void service.exitSearch() }}
            />
          ) : service.filtered ? (
```

（`filtered` / 默认空态两支保持现网，只在中间插入 searching 支。）

import `humanError` from `@/lib/errors`。

Modify `apps/web/src/pages/chain-home/index.tsx`：

- import `TimelineSearchField`、`formatSearchParsed`（`Banner` / `humanError` 已在文件里）
- 仅当 `service.activeView === 'timeline'`：在 `<TimelineRail` **之前**插入（非 timeline tab 不挂搜索）：

```tsx
      {service.activeView === 'timeline' ? (
        <TimelineSearchField
          onSubmit={(q) => void service.submitSearch(q)}
          onClear={() => {
            if (service.searching) void service.exitSearch();
          }}
        />
      ) : null}
```

- 删 sticky「回到今天」之后、`service.activeView === 'timeline'` 的 `<Timeline` 之前（T5 已插 `FilterChips` 的位置）再插搜索 Banner：

```tsx
          {service.searchError ? (
            <Banner tone="error">{humanError(service.searchError)}</Banner>
          ) : service.searching && service.searchParsed ? (
            <Banner tone="info" action={{ label: '关闭', onPress: () => void service.exitSearch() }}>
              {formatSearchParsed(service.searchParsed)}
            </Banner>
          ) : null}
```

- `empty` 现网是 `service.filtered ? (筛选空态) : (还没有记下)`。改成 `searching` → `filtered` → 默认：

```tsx
            service.searching ? (
              <EmptyState
                variant="timeline"
                scope="section"
                title="没有找到相关时刻"
                description="换个说法，或关掉搜索回到时间线。"
                action={{ label: '退出搜索', emphasis: 'quiet', onPress: () => void service.exitSearch() }}
              />
            ) : service.filtered ? (
```

（后面两支保持现网。）

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 四条 + 
```
pnpm --filter @moment/web test -- src/pages/chain-home/chain-home.test.tsx
pnpm --filter @moment/web test -- src/pages/timeline-variants.test.tsx
```
Expected: PASS。分享页测试不出现「搜索时刻」Label（该变体不挂 `TimelineSearchField`）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/search-summary.ts apps/web/src/lib/search-summary.test.ts apps/web/src/timeline/search-field.tsx apps/web/src/timeline/search-field.test.tsx apps/web/src/pages/feed-home/feed-home.service.ts apps/web/src/pages/feed-home/feed-home.service.test.ts apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/chain-home/chain-home.service.ts apps/web/src/pages/chain-home/chain-home.service.test.ts apps/web/src/pages/chain-home/index.tsx
git commit -m "feat(web): search moments from the timeline Field"
```

---

### Task 7: 链设置 owner「处理中」分区（10s 轮询，无重试按钮）

**Files:**
- Modify: `apps/web/src/pages/chain-settings/chain-settings.service.ts`
- Modify: `apps/web/src/pages/chain-settings/chain-settings.service.test.ts`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`
- Create: `apps/web/src/pages/chain-settings/jobs-section.tsx`
- Create: `apps/web/src/pages/chain-settings/jobs-section.test.tsx`

**Interfaces:**
- Consumes: Task 1 `client.listChainJobs`；P1 `ChainJobDto`；既有 `isOwner` / `EmptyState` / `Banner` / `humanError` / `ChainSettingsService.hydrate`
- Produces:
  - `JOBS_POLL_MS = 10000`
  - `jobTypeLabel(type)`：`moment.compress` →「压缩图」；`moment.embed` →「索引」
  - `jobStatusLabel(status)`：`pending` →「处理中」；`failed` →「失败」；`done` →「完成」
  - `ChainSettingsService.jobs: ChainJobDto[]`、`loadJobs(): Promise<void>`（默认 query，不传 status）
  - `ChainSettingsSections` 的 `Section` 联合类型 `|= 'jobs'`；`items` 增 `{ key:'jobs', label:'处理中', show: owner }`
  - `<JobsSection />`：mount 时 `loadJobs`，`setInterval(JOBS_POLL_MS)`，unmount `clearInterval`；列类型、momentId 前 8 位、状态、次数、`lastError`、`toLocaleString(createdAt)`；空态「没有处理中的任务」
  - editor/viewer **不**见该 tab（因此不会打 jobs API）
  - v1 无重试按钮 / 无「再跑一次」文案

- [ ] **Step 1: 写失败测试**

Modify `apps/web/src/pages/chain-settings/chain-settings.service.test.ts`：

(a) `api` hoisted 对象加 `listChainJobs: vi.fn()`。

(b) 现网文件**已有**统一 `beforeEach`：在其中加 `api.listChainJobs.mockReset().mockResolvedValue({ jobs: [] })`。并在 `resetService()` 里加 `service.jobs = []`（T7 落地该字段后；T7 测试未跑前先写进测试会 typecheck 红——把这一行放在本 Task 的测试修改里、与 `jobs` 字段同一 commit）。

(c) 文件末尾追加：

```ts
describe('loadJobs（spec fused-retrieval §7.4）', () => {
  it('GET listChainJobs(chainId) 无 query；写入 jobs', async () => {
    const row = {
      id: 'j-1',
      type: 'moment.compress' as const,
      status: 'failed' as const,
      momentId: '12345678-aaaa-bbbb-cccc-dddddddddddd',
      mediaId: 'm-1',
      attempts: 1,
      lastError: 'OBJECT_TOO_LARGE',
      createdAt: '2026-08-29T00:00:00.000Z',
      processedAt: null,
    };
    api.listChainJobs.mockResolvedValueOnce({ jobs: [row] });
    const s = resolve(ChainSettingsService);
    s.chainId = 'chain-1';
    await s.loadJobs();
    expect(api.listChainJobs).toHaveBeenCalledWith('chain-1');
    expect(s.jobs).toEqual([row]);
  });

  it('loadChain 不级联 listChainJobs（spec：进入分区才 load）', async () => {
    const s = await seedChain(makeChain());
    expect(api.listChainJobs).not.toHaveBeenCalled();
    expect(s.jobs).toEqual([]);
  });
});
```

Create `apps/web/src/pages/chain-settings/jobs-section.test.tsx`：

```tsx
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainSettingsService } from './chain-settings.service';
import { ChainSettingsSections } from './sections';
import { JOBS_POLL_MS, JobsSection, jobStatusLabel, jobTypeLabel } from './jobs-section';

const api = vi.hoisted(() => ({
  listChainJobs: vi.fn(),
  getChain: vi.fn(),
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  listShareLinks: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  client: api,
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);
register(ChainSettingsService);

function chain(role: ChainDto['myRole']): ChainDto {
  return {
    id: 'chain-1',
    name: '周末小家',
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: 'mint',
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    myRole: role,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
  };
}

beforeEach(() => {
  api.listChainJobs.mockReset().mockResolvedValue({ jobs: [] });
  api.listMembers.mockResolvedValue([]);
  api.listInvites.mockResolvedValue([]);
  api.listShareLinks.mockResolvedValue({ items: [] });
  api.listTags.mockResolvedValue({ tags: [] });
  const s = resolve(ChainSettingsService);
  s.chainId = 'chain-1';
  s.jobs = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('job labels', () => {
  it('类型与状态文案锁定 spec §7.4', () => {
    expect(jobTypeLabel('moment.compress')).toBe('压缩图');
    expect(jobTypeLabel('moment.embed')).toBe('索引');
    expect(jobStatusLabel('pending')).toBe('处理中');
    expect(jobStatusLabel('failed')).toBe('失败');
    expect(jobStatusLabel('done')).toBe('完成');
  });
});

function renderSections() {
  return render(
    <MemoryRouter>
      <RSRoot>
        <ChainSettingsSections />
      </RSRoot>
    </MemoryRouter>,
  );
}

describe('ChainSettingsSections jobs tab', () => {
  it('owner 可见「处理中」；editor 不可见', () => {
    const s = resolve(ChainSettingsService);
    s.chain = chain('owner');
    const { unmount } = renderSections();
    expect(screen.getByRole('button', { name: '处理中' })).toBeInTheDocument();
    unmount();
    s.chain = chain('editor');
    renderSections();
    expect(screen.queryByRole('button', { name: '处理中' })).toBeNull();
  });
});

describe('JobsSection', () => {
  it('空态「没有处理中的任务」；无重试按钮', async () => {
    api.listChainJobs.mockResolvedValue({ jobs: [] });
    await act(async () => {
      render(
        <RSRoot>
          <JobsSection />
        </RSRoot>,
      );
    });
    expect(await screen.findByText('没有处理中的任务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试|再跑/ })).toBeNull();
  });

  it('列出类型、短 momentId、状态、次数、lastError', async () => {
    api.listChainJobs.mockResolvedValue({
      jobs: [
        {
          id: 'j-1',
          type: 'moment.compress',
          status: 'failed',
          momentId: '12345678-aaaa-bbbb-cccc-dddddddddddd',
          mediaId: 'm-1',
          attempts: 1,
          lastError: 'OBJECT_TOO_LARGE',
          createdAt: '2026-08-29T00:00:00.000Z',
          processedAt: null,
        },
      ],
    });
    await act(async () => {
      render(
        <RSRoot>
          <JobsSection />
        </RSRoot>,
      );
    });
    expect(await screen.findByText('压缩图')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('1 次')).toBeInTheDocument();
    expect(screen.getByText('OBJECT_TOO_LARGE')).toBeInTheDocument();
  });

  it(`可见时每 ${10000}ms 再 load 一次，unmount 停止`, async () => {
    vi.useFakeTimers();
    api.listChainJobs.mockResolvedValue({ jobs: [] });
    const { unmount } = render(
      <RSRoot>
        <JobsSection />
      </RSRoot>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.listChainJobs).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(JOBS_POLL_MS);
      await Promise.resolve();
    });
    expect(api.listChainJobs).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(JOBS_POLL_MS);
      await Promise.resolve();
    });
    expect(api.listChainJobs).toHaveBeenCalledTimes(2);
  });
});
```

`JOBS_POLL_MS` 在测试里既用于 `advanceTimersByTime` 也用于断言间隔，禁止魔法数 `10000` 与实现漂移——测试 import 同一常量。

- [ ] **Step 2: 运行确认失败**

Run:
```
pnpm --filter @moment/web test -- src/pages/chain-settings/chain-settings.service.test.ts
pnpm --filter @moment/web test -- src/pages/chain-settings/jobs-section.test.tsx
```
Expected: FAIL——`loadJobs is not a function` / 无法 resolve `./jobs-section`。既有外观用例不得被本次 `api` 加字段破坏（`listChainJobs` 只是多一个 fn）。

- [ ] **Step 3: 最小实现**

Modify `apps/web/src/pages/chain-settings/chain-settings.service.ts`：

- import `type { ChainJobDto } from '@moment/dto';`
- 字段 `jobs: ChainJobDto[] = [];`
- 方法：

```ts
  async loadJobs(): Promise<void> {
    const res = await client.listChainJobs(this.chainId);
    this.jobs = res.jobs;
  }
```

**不要**在 `loadChain` 级联里调 `loadJobs`（spec：进入分区才 load）。

Modify 同文件测试的 `resetService()`：在 `service.tags = []` 之后加 `service.jobs = []`。

Create `apps/web/src/pages/chain-settings/jobs-section.tsx`：

```tsx
import { useEffect } from 'react';
import type { ChainJobDto } from '@moment/dto';
import { observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { Banner, EmptyState } from '@/ui/feedback/index';
import { ChainSettingsService } from './chain-settings.service';

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

export const JobsSection = observer(function JobsSection() {
  const service = useService(ChainSettingsService);

  useEffect(() => {
    void service.loadJobs().catch(() => undefined);
    const id = window.setInterval(() => {
      void service.loadJobs().catch(() => undefined);
    }, JOBS_POLL_MS);
    return () => window.clearInterval(id);
  }, [service]);

  const error = service.$model.loadJobs.error;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">处理中</h2>
      <p className="text-meta text-muted">压缩图和检索索引的后台任务，只有创建者看得到。</p>
      {error ? <Banner tone="error">{humanError(error)}</Banner> : null}
      {service.jobs.length === 0 ? (
        <EmptyState variant="plain" scope="section" title="没有处理中的任务" description="发布新照片后，压缩和索引会排在这里。" />
      ) : (
        <ul className="flex flex-col gap-1">
          {service.jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-baseline gap-2 py-2 text-meta">
              <span className="text-ink">{jobTypeLabel(job.type)}</span>
              <span className="text-muted">{job.momentId.slice(0, 8)}</span>
              <span>{jobStatusLabel(job.status)}</span>
              <span className="text-muted">{job.attempts} 次</span>
              {job.lastError ? <span className="text-danger">{job.lastError}</span> : null}
              <span className="ml-auto text-muted">{new Date(job.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
```

Modify `apps/web/src/pages/chain-settings/sections.tsx`：

- import `JobsSection`
- `type Section = 'share' | 'members' | 'profile' | 'jobs';`
- `items` 数组追加 `{ key: 'jobs', label: '处理中', show: owner }`
- 分区内容追加 `{section === 'jobs' && owner && <JobsSection />}`

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2
Expected: PASS。owner 看得到「处理中」；editor 看不到；空态无重试；10s 第二次 `listChainJobs`；unmount 后不再增加调用。

- [ ] **Step 5: 全量 web / api-client 门禁**

Run:
```
pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client typecheck && pnpm --filter @moment/api-client lint
pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build
```
Expected: 全绿。禁止为了绿灯去改 `vitest.config.ts` / `package.json` scripts / `tokens.css`。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/chain-settings/chain-settings.service.ts apps/web/src/pages/chain-settings/chain-settings.service.test.ts apps/web/src/pages/chain-settings/sections.tsx apps/web/src/pages/chain-settings/jobs-section.tsx apps/web/src/pages/chain-settings/jobs-section.test.tsx
git commit -m "feat(web): show owner processing jobs in chain settings"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/api-client test` / `typecheck` / `lint` / `build` 全绿
- [ ] 冻结名可解析：`searchMoments(input)`、`listChainJobs(chainId, query?)`、`mediaUrl(id, { variant?, st? })`、`fetchMediaBlob(id, { variant? })`、`FeedQuery.personId|place|happenedFrom|happenedTo`、`RailFilter.personId` / `RailFilter.place`
- [ ] `mediaUrl`：无 query 的 original + `st` → `?st=`；`variant=derived` + `st` → `&st=`；测试钉死 `tok en` → `tok%20en`；`requestBlob` 401 重放 URL 仍含 `variant=derived`
- [ ] 搜索翻页：`loadMore` 在 `searching` 时 POST `cursor`、不带 `before`/`parsed`、不覆盖首页 `searchParsed`
- [ ] `pnpm --filter @moment/web test` 全绿，至少含：`useMediaObjectUrl.test.tsx`（variant 分缓存 + derived 回退）、`MediaBlock.test.tsx`（derived 卡片 / `&st=` / 无优化中）、`lightbox.test.tsx`（只用 original）、`feed.test.ts`、`feed-home.service.test.ts`、`chain-home.service.test.ts`、`moment-sheet-people-place.test.tsx`（分享 span + 时间线 button）、`filter-chips.test.tsx`、`search-field.test.tsx`、`search-summary.test.ts`、`jobs-section.test.tsx`
- [ ] 未新增 package scripts、未改 `vitest.config.ts` / `tokens.css` / `tailwind.config.js`
- [ ] 未出现名为 `SearchBar` 的组件；搜索是 `TextField type="search"`
- [ ] 未封装 `/api/internal/*`；`apps/app/**` 零 diff
- [ ] 分享页无搜索、无 jobs；PublicShareMoment 无 persons/place 行
- [ ] 手测清单：
  1. 链主页点人物 chip → 列表只剩该人；再点同一人 / 点顶栏「外婆 ×」恢复；地点行同
  2. 有 `before` 时点人：GET 同时带 `before`+`person_id`；搜索框提交**不**把 `before` 带给 POST
  3. 搜索「去年今天和外婆」→ 结果替换时间线 + info Banner 摘要；关 Banner 回到 GET 时间线
  4. 空搜索结果「没有找到相关时刻」；故意打满限流见「操作太频繁」Banner，无 Toast
  5. 有 `derivedUrl` 的卡片比 Lightbox 更糊/更小（512 WebP vs 原图）；GIF 无 derived 卡片仍原图、无「优化中」
  6. 公开分享链接：图 src 为 `.../media/:id?st=` 或 derived 的 `.../media/:id?variant=derived&st=`，从不断成 `?variant=derived?st=`
  7. 链设置：owner 有「处理中」，editor 无；空态「没有处理中的任务」；停留 10s 以上网络面板能看到重复 GET jobs
  8. 浅色/深色、390px 宽：搜索框 Label 不挤；chip `focus-visible` 可见

## 写完自查（起草者已执行）

- **spec 覆盖（仅 P8）**：§6.1 FeedQuery camelCase；§6.2 `searchMoments`；§6.4 `listChainJobs`；§6.5 mediaUrl/fetchMediaBlob/cache key；§7.1 chip 单选 + 清除 chip + rab 内存；§7.2 Field type=search + POST + parsed 摘要 + 不带 before + 翻页 cursor 不改 parsed + EmptyState + 429 humanError + 不做建议下拉/URL；§7.3 卡片 derived / Lightbox original / `&st=`（含分享 posterDerivedUrl）；§7.4 jobs owner 10s 轮询、进入分区才 load；§8 分享无搜索/jobs/persons 按钮；§9 web 测试条目；§11 P8 出口。P9 `useMediaUri` 不在 Files。偏差 16–17：搜索中保留 before chip；original 的 `fetchMediaBlob` 不传第二参。
- **占位符扫描**：无 TBD / TODO /「适当处理」/「类似 Task N」/「Write tests for the above」。
- **跨 Task 类型**：T1 `mediaUrl`/`fetchMediaBlob` 被 T2/T3 逐字消费；T4 `togglePersonFilter({id,name})` 被 T5 点击与 T6 AND 搜索消费；`SearchParsed` 来自 P1 被 T6 Banner 消费；`ChainJobDto` 来自 P1 被 T7 消费。无 `clearLayers` 式改名。
- **web-ui Owner**：Files 不含 `tokens.css` / `tailwind.config.js` / `vitest.config.ts` / `apps/web/package.json`。chip 类名复用轨上 `rounded-full border ... text-caption` + `ring-focus`。
- **不泄漏 P9/P10**：无 `apps/app`、无 `useMediaUri`、无 `backfill:embed`、无 server e2e。
