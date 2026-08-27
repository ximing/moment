# 链头像、Emoji 与封面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web 端链头像支持 Emoji、上传图片、自定义纯色三种互斥模式，并支持独立大封面、焦点调整、公开分享展示和完整的 S3/MinIO 媒体回收闭环。

**Architecture:** `chains` 直接持有 avatar/cover media 引用和整数焦点，媒体继续走现有 presign → tmp → server copy → final 流程；服务端把任何输入归一化为互斥持久态。DTO 返回稳定 `/api/media/:id`，登录态由 Blob 通道读取，公开分享追加 share token；Web 使用共用受控编辑器，Frimousse 的中文 Emojibase 数据由 Vite 从本地依赖复制为同源静态资源。

**Tech Stack:** zod 3 + emoji-regex 10.6（DTO）/ Drizzle + MySQL 8.4 + routing-controllers + TypeDI + Jest（Server）/ S3-compatible storage（MinIO）/ React 19 + @rabjs/react + Frimousse 0.3 + Emojibase Data 17 + React Aria 既有基元 + Vitest/jsdom（Web）/ CSI 真实 Chrome 验收。

**Spec:** `docs/superpowers/specs/2026-08-27-chain-appearance-design.md`

## Global Constraints

- 链头像持久态严格互斥：图片=`avatarMediaId`，Emoji=`icon`，纯色=`color`；旧客户端的 `color + icon` 请求允许但按 Emoji 优先归一化。
- `ChainColor`/`chainColorSchema` 继续只表示预设色；链自定义色使用新增 `ChainAppearanceColor`/`chainAppearanceColorSchema`，不得扩大用户头像协议。
- 所有媒体 DTO 只返回稳定 `/api/media/:id`，禁止内嵌预签名 GET URL（`CONVENTIONS.md` §3.4）。登录 Web 图片必须走 `client.fetchMediaBlob`，不能裸 `<img src="/api/media/...">` 绕过 Bearer。
- 头像、封面只接受既有 raster image allowlist，明确拒绝 SVG、audio、video；头像与封面不能引用同一个 media id。
- 焦点 API 为 `[0,1]`，数据库为 `[0,10000]` int，默认中心 5000；不生成裁剪副本。
- 大封面只出现在链首页和公开分享页；侧栏、顶部链列表、汇总时间线与“那年今日”只使用头像。
- Frimousse 运行时只能请求 Moment 同源 `/vendor/emojibase/zh/{data,messages}.json`；不得放宽 CSP 或请求 jsDelivr/Liveblocks/GitHub。
- Web 新代码只消费既有 Design System tokens/基元，不改 `tokens.css`、Tailwind 映射、Vitest setup 或 package scripts。
- Server 测试触 `.env` 指向的真实测试库并固定 `--runInBand`；外部存储全部 mock。迁移回填先在隔离本地 MySQL schema 验证，严禁生产库。
- 每个 Task 独立 TDD 红绿循环并单独 conventional commit；不要提交 `.superpowers/brainstorm/**`。

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/dto/src/chains.ts` / `chains.test.ts` | 新颜色、Emoji、focus、输入互斥、ChainDto | Modify |
| `packages/dto/src/share.ts` / `share.test.ts` | 分享链视觉字段 | Modify |
| `packages/dto/package.json` / `pnpm-lock.yaml` | `emoji-regex@10.6.0` | Modify |
| `apps/server/src/db/schema/chains.ts` / `media.ts` | avatar/焦点/orphanedAt | Modify |
| `apps/server/drizzle/0015_*.sql` + `meta/*` | schema 迁移与历史回填 | Create/Modify |
| `apps/server/tests/migrations/chain-appearance-backfill.test.ts` | 本地 MySQL 迁移验证 | Create |
| `apps/server/src/media/media.service.ts` / `media.controller.ts` | discard、链资源访问 | Modify |
| `apps/server/src/worker/sweeper.ts` / `worker/index.ts` / `worker/handlers.ts` | ready 临时资源与 orphan 清理 | Modify |
| `apps/server/src/auth/auth.service.ts` | 用户头像替换写 orphanedAt | Modify |
| `apps/server/src/chains/chain-appearance.ts` | 纯归一化与焦点转换 | Create |
| `apps/server/src/chains/chain-media.ts` | media 行锁、copy、补偿、替换 | Create |
| `apps/server/src/chains/chain.service.ts` | create/update/delete/serialize 接线 | Modify |
| `apps/server/src/share/share-link.service.ts` | PublicShareChainInfo 视觉字段 | Modify |
| `apps/server/tests/helpers/db.ts` / `src/e2e/fixture-seeder.ts` | 清表前解除 chain→media 引用循环 | Modify |
| `packages/api-client/src/client.ts` / `upload.ts` | discard + 暴露 presign mediaId | Modify |
| `apps/web/src/chain/appearance-model.ts` | 草稿、请求投影、焦点数学 | Create |
| `apps/web/src/chain/appearance-upload.ts` | 共用上传/丢弃助手 | Create |
| `apps/web/src/chain/EmojiPickerPanel.tsx` | Frimousse 中文同源选择器 | Create |
| `apps/web/src/chain/FocalImageEditor.tsx` | 拖动与 range 焦点编辑 | Create |
| `apps/web/src/chain/ChainAppearanceEditor.tsx` | 三模式头像 + 独立封面编辑 UI | Create |
| `apps/web/src/chain/ChainMark.tsx` / `ChainCover.tsx` | 头像与封面展示/回退 | Modify/Create |
| `apps/web/src/media/useMediaObjectUrl.ts` | 同 mediaId Blob 请求去重与引用计数 | Modify |
| `apps/web/src/lib/chain-color.ts` | 预设 token 与 hex 转 CSS | Modify |
| `apps/web/src/shell/create-chain-dialog/*` | 创建链接入共用编辑器 | Modify |
| `apps/web/src/pages/chain-settings/*` | 设置页上传、保存、清理 | Modify |
| `apps/web/src/pages/chain-home/index.tsx` | 登录态封面 | Modify |
| `apps/web/src/pages/share-album/index.tsx` | 分享头像/封面 | Modify |
| `apps/web/src/timeline/*`, `memories/*`, `pages/feed-home/index.tsx`, `shell/chain-nav-list.tsx` | 头像字段透传 | Modify |
| `apps/web/package.json`, `vite.config.ts`, `pnpm-lock.yaml` | Frimousse/Emojibase/静态复制 | Modify |

---

### Task 1: DTO — 链视觉契约与兼容输入

**Files:**
- Modify: `packages/dto/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/dto/src/chains.ts`
- Modify: `packages/dto/src/chains.test.ts`
- Modify: `packages/dto/src/share.ts`
- Modify: `packages/dto/src/share.test.ts`

**Interfaces:**
- Consumes: 既有 `CHAIN_COLORS`, `chainColorSchema`, `ChainColor`, `createChainInputSchema`, `updateChainInputSchema`, `ChainDto`, `PublicShareChainInfo`。
- Produces:
  - `chainAppearanceColorSchema` / `ChainAppearanceColor`：预设色或规范化大写 `#RRGGBB`。
  - `chainIconSchema` / `ChainIcon`：恰好一个完整 Unicode Emoji 序列，最大 64 code units。
  - `chainImageFocusSchema` / `ChainImageFocus`：`{x:number;y:number}`，两轴 `[0,1]`。
  - create/update 新字段：`avatarMediaId`, `avatarFocus`, `coverMediaId`, `coverFocus`。
  - `ChainDto` 新字段：`avatarMediaId`, `avatarUrl`, `avatarFocus`, `coverUrl`, `coverFocus`。
  - `PublicShareChainInfo` 同名只读视觉字段。

- [ ] **Step 1: 写失败测试**

在 `chains.test.ts` 增加以下行为用例：

```ts
test('链自定义色规范化；既有 ChainColor 仍只接受预设', () => {
  assert.equal(chainAppearanceColorSchema.parse('#a1b2c3'), '#A1B2C3');
  assert.equal(chainAppearanceColorSchema.parse('mint'), 'mint');
  assert.throws(() => chainAppearanceColorSchema.parse('#abc'));
  assert.throws(() => chainColorSchema.parse('#A1B2C3'));
});

test('链 Emoji 接受单个组合序列并拒绝文本或多个 Emoji', () => {
  for (const icon of ['👶🏽', '🏳️‍🌈', '👨‍👩‍👧‍👦']) assert.equal(chainIconSchema.parse(icon), icon);
  for (const icon of ['', 'family', '😀😃']) assert.throws(() => chainIconSchema.parse(icon));
});

test('图片模式拒绝与 color/icon 混传；旧 color+icon 仍可解析', () => {
  const legacy = createChainInputSchema.parse({ name: '旧端', template: 'daily', color: 'mint', icon: '👶' });
  assert.equal(legacy.icon, '👶');
  assert.throws(() => createChainInputSchema.parse({
    name: '冲突', template: 'daily', color: 'mint', avatarMediaId: '00000000-0000-4000-8000-000000000001',
  }));
});

test('focus 边界与删除封面组合', () => {
  assert.deepEqual(chainImageFocusSchema.parse({ x: 0, y: 1 }), { x: 0, y: 1 });
  assert.throws(() => chainImageFocusSchema.parse({ x: -0.01, y: 0.5 }));
  assert.throws(() => createChainInputSchema.parse({
    name: '无图焦点', template: 'daily', coverFocus: { x: 0.5, y: 0.5 },
  }));
  assert.throws(() => updateChainInputSchema.parse({ coverMediaId: null, coverFocus: { x: 0.5, y: 0.5 } }));
});
```

在 `share.test.ts` 增加一个完整 `PublicShareChainInfo` 类型样例，明确稳定 URL 是 `/api/media/m1`，没有 expires 字段。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/dto exec tsx --test src/chains.test.ts src/share.test.ts`

Expected: FAIL，新增 schema/type 尚未导出；旧 `chainIconSchema` 也会拒绝组合 Emoji。

- [ ] **Step 3: 安装并实现 schema**

Run: `pnpm --filter @moment/dto add emoji-regex@10.6.0`

在 `chains.ts` 保留预设色类型，新增链颜色与 Emoji 精确校验：

```ts
import emojiRegex from 'emoji-regex';

export const chainAppearanceColorSchema = z.union([
  chainColorSchema,
  z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform((value) => value.toUpperCase() as `#${string}`),
]);
export type ChainAppearanceColor = z.infer<typeof chainAppearanceColorSchema>;

export const chainIconSchema = z.string().min(1).max(64).refine((value) => {
  const matches = [...value.matchAll(emojiRegex())];
  return matches.length === 1 && matches[0]![0] === value;
}, 'exactly one emoji required');
export type ChainIcon = z.infer<typeof chainIconSchema>;

export const chainImageFocusSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export type ChainImageFocus = z.infer<typeof chainImageFocusSchema>;
```

把 create/update 的 `color` 改为 `chainAppearanceColorSchema`；加入 media/focus 字段。create 的 `superRefine` 拒绝 avatarMediaId 与非空 color/icon 混传，并拒绝没有对应 mediaId 的 focus；update 允许单独 focus，但拒绝 `mediaId:null + focus`。保留空 patch refine。

`avatarMediaId`/`coverMediaId` 的非空输入统一使用 `z.string().uuid()`，不得接受任意路径、对象 key 或非 UUID 字符串。

- [ ] **Step 4: 扩展响应 interface**

`ChainDto` 的视觉字段固定为：

```ts
avatarMediaId: string | null;
avatarUrl: string | null;
avatarFocus: ChainImageFocus | null;
coverMediaId: string | null;
coverUrl: string | null;
coverFocus: ChainImageFocus | null;
color: ChainAppearanceColor | null;
icon: ChainIcon | null;
```

`PublicShareChainInfo` 使用同一组字段，再保留 `name/description`。

- [ ] **Step 5: 运行绿灯与构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build && pnpm --filter @moment/dto lint`

Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add packages/dto/package.json packages/dto/src/chains.ts packages/dto/src/chains.test.ts packages/dto/src/share.ts packages/dto/src/share.test.ts pnpm-lock.yaml
git commit -m "feat(dto): define chain appearance contracts"
```

---

### Task 2: 数据库 — chain 视觉列、orphanedAt 与迁移回填

**Files:**
- Modify: `apps/server/src/db/schema/chains.ts`
- Modify: `apps/server/src/db/schema/media.ts`
- Modify: `apps/server/tests/chains/schema.test.ts`
- Create: `apps/server/tests/migrations/chain-appearance-backfill.test.ts`
- Create/Modify: `apps/server/drizzle/0015_*.sql`, `apps/server/drizzle/meta/_journal.json`, `apps/server/drizzle/meta/0015_snapshot.json`

**Interfaces:**
- Produces `chains.avatarMediaId`, four focus ints, widened `chains.icon`；`media.orphanedAt: Date|null`。
- 迁移把历史 `icon != null` 行的 `color` 清空，把历史 orphaned media 的 `orphanedAt` 回填为 `createdAt`。

- [ ] **Step 1: 写 schema 红灯测试**

在 `schema.test.ts` 插入一条 chain；再以固定 `const orphanedAt = new Date('2026-08-27T00:00:00Z')` 插入一条显式带该值的 orphaned media，断言：

```ts
expect(row.avatarMediaId).toBeNull();
expect(row.avatarFocusX).toBe(5000);
expect(row.avatarFocusY).toBe(5000);
expect(row.coverFocusX).toBe(5000);
expect(row.coverFocusY).toBe(5000);
expect(orphan.orphanedAt?.toISOString()).toBe(orphanedAt.toISOString());
```

先只写断言，不改 schema。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/server test -- tests/chains/schema.test.ts`

Expected: FAIL（TS2339 或字段为 undefined）。确认当前 `.env` 明确指向测试库；若无法确认，停止此命令并先配置 `apps/server/.env.test`。

- [ ] **Step 3: 修改 Drizzle schema**

`chains.ts` 新增 FK、四个 `int().notNull().default(5000)` 和四个 check；`icon` 改 `varchar(64)`。check 命名固定为 `chk_chains_avatar_focus_x/y`、`chk_chains_cover_focus_x/y`。`media.ts` 新增 nullable `orphanedAt`。

- [ ] **Step 4: generate 后立即追加回填**

Run: `pnpm --filter @moment/server migrate:generate`

在任何 migrate/test/dev 之前，编辑 journal 新增的 idx=15 SQL 文件，在 ALTER 之后追加：

```sql
--> statement-breakpoint
UPDATE `chains` SET `color` = NULL WHERE `icon` IS NOT NULL;
--> statement-breakpoint
UPDATE `media` SET `orphaned_at` = `created_at`
WHERE `status` = 'orphaned' AND `orphaned_at` IS NULL;
```

Run: `git diff --check apps/server/drizzle && cat apps/server/drizzle/0015_*.sql`

Expected: ALTER、四个 check、icon 扩宽、两条 UPDATE 都在首次执行前完整存在。

- [ ] **Step 5: 写并运行隔离迁移测试**

复制既有 `chain-members-sort-order-backfill.test.ts` 的独立连接/statement-breakpoint 执行器，新测试固定执行 0000–0014、插入：一条 `color='mint', icon='👶'` 链、一条 orphaned media，再执行 journal idx=15；断言 color=null、icon 保留、四焦点=5000、orphaned_at=created_at、icon 列可保存 ZWJ Emoji。

Run: `docker compose up -d mysql`

Run: `SKIP_GLOBAL_MIGRATE=1 RUN_MIGRATION_IT=1 pnpm --filter @moment/server test -- chain-appearance-backfill`

Expected: PASS；测试 afterAll 删除临时 schema，不读取远程 `.env`。

- [ ] **Step 6: 首次应用测试库迁移并回归 schema**

确认回填 SQL 已固定且数据库名为测试库后运行：

Run: `pnpm --filter @moment/server migrate && pnpm --filter @moment/server test -- tests/chains/schema.test.ts`

Expected: migrate 成功；schema test PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/db/schema/chains.ts apps/server/src/db/schema/media.ts apps/server/drizzle/0015_*.sql apps/server/drizzle/meta/0015_snapshot.json apps/server/drizzle/meta/_journal.json apps/server/tests/chains/schema.test.ts apps/server/tests/migrations/chain-appearance-backfill.test.ts
git commit -m "feat(server): add chain appearance storage columns"
```

---

### Task 3: Media 生命周期 — discard、stale ready 与 orphan sweeper

**Files:**
- Modify: `apps/server/src/media/media.service.ts`
- Modify: `apps/server/src/media/media.controller.ts`
- Modify: `apps/server/src/auth/auth.service.ts`
- Modify: `apps/server/src/worker/handlers.ts`
- Modify: `apps/server/src/worker/sweeper.ts`
- Modify: `apps/server/src/worker/index.ts`
- Create: `apps/server/tests/media/media-discard.test.ts`
- Modify: `apps/server/tests/worker/sweeper.test.ts`
- Modify: `apps/server/tests/auth/avatar.test.ts`

**Interfaces:**
- Produces `MediaService.discard(userId:string, mediaId:string):Promise<void>`；`DELETE /api/media/:id → 204`。
- Produces `sweepStaleUnboundReadyMedia()` 与 `sweepOrphanedMedia()`。
- 所有 status→orphaned 更新必须同时写 `orphanedAt`。

- [ ] **Step 1: 写 discard 与 sweeper 红灯测试**

覆盖以下矩阵：uploader 删除 uploading 会 abort multipart；ready 未引用变 orphaned；重复删除 204；他人 404；Moment、用户头像、链 avatar/cover 活引用返回 `MEDIA_ALREADY_BOUND`。Sweeper 覆盖 stale unbound ready 被标 orphaned、fresh/引用中不动、过期 orphan 删除对象后删行、deleteFile 失败保留行、dry-run 不写。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/server test -- tests/media/media-discard.test.ts tests/worker/sweeper.test.ts tests/auth/avatar.test.ts`

Expected: FAIL（DELETE route/sweeper exports/orphanedAt 写入尚不存在）。

- [ ] **Step 3: 实现统一 orphan 写入与 discard**

`discard` 在事务中 `FOR UPDATE` media，查询 users/chains 引用；引用存在或 `momentId` 非空抛 `BadRequestError('MEDIA_ALREADY_BOUND')`。ready 更新：

```ts
await tx.update(media).set({ status: 'orphaned', orphanedAt: new Date() }).where(eq(media.id, row.id));
```

uploading 同样先条件更新，再在事务后 best-effort `abortMultipart`；orphaned 幂等。Controller 使用 `@Delete('/:id') + @Authorized() + @HttpCode(204) + @OnUndefined(204)`。

同步修改既有 `abort`、`AuthService.bindAvatar` 替换旧头像、`handleMomentDeleted`，每次写 orphaned 都写 `orphanedAt`。

- [ ] **Step 4: 实现两个 sweeper 并接 worker**

`sweepStaleUnboundReadyMedia` 候选条件为 ready、`momentId IS NULL`、createdAt 超 `MEDIA_UPLOADING_TTL_HOURS`，并通过 left join 排除 users/chains 活引用；逐行条件更新为 orphaned。`sweepOrphanedMedia` 用 `orphanedAt < now-30d`，复用 `destroyMediaObject`，对象成功删除后才删行。`worker/index.ts` 在 stale uploading 之后依次调用这两个任务。

- [ ] **Step 5: 运行绿灯**

Run: `pnpm --filter @moment/server test -- tests/media/media-discard.test.ts tests/worker/sweeper.test.ts tests/auth/avatar.test.ts`

Expected: 全部 PASS，无 open handle。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/media/media.service.ts apps/server/src/media/media.controller.ts apps/server/src/auth/auth.service.ts apps/server/src/worker/handlers.ts apps/server/src/worker/sweeper.ts apps/server/src/worker/index.ts apps/server/tests/media/media-discard.test.ts apps/server/tests/worker/sweeper.test.ts apps/server/tests/auth/avatar.test.ts
git commit -m "feat(server): close unbound media lifecycle"
```

---

### Task 4: Server 链视觉归一化、图片绑定与稳定 DTO

**Files:**
- Create: `apps/server/src/chains/chain-appearance.ts`
- Create: `apps/server/src/chains/chain-media.ts`
- Modify: `apps/server/src/chains/chain.service.ts`
- Modify: `apps/server/src/media/media.service.ts`
- Create: `apps/server/tests/chains/chains.appearance.test.ts`
- Modify: `apps/server/tests/chains/chains.crud.test.ts`
- Modify: `apps/server/tests/media/media-access.test.ts`
- Modify: `apps/server/src/e2e/fixture-rows.ts`
- Modify: `apps/server/src/e2e/fixture-rows.test.ts`
- Modify: `apps/server/src/e2e/fixture-seeder.ts`
- Modify: `apps/server/tests/helpers/db.ts`

**Interfaces:**
- Produces `defaultChainColor(chainId):ChainColor`（与 Web FNV-1a 相同）。
- Produces `focusToDb(ChainImageFocus):{x:number;y:number}` / `focusFromDb(x,y):ChainImageFocus`。
- Produces `normalizeCreateAppearance(chainId,input)` 与 `normalizeUpdateAppearance(chainId,current,input)`，输出数据库 patch。
- Produces `bindChainMedia(tx,args):Promise<ChainMediaBinding>`、`cleanupBoundMedia(binding)`、`rollbackBoundMedia(binding)`。

- [ ] **Step 1: 写纯逻辑与 API 红灯测试**

测试：无视觉输入创建会持久化哈希预设色；custom hex 大写；旧 color+icon 最终只存 icon；三模式往返清空其它字段；焦点四舍五入到 int 并可逆；图片 owner/ready/raster/unbound 校验；同一 media 幂等只改焦点；替换/删除旧媒体写 orphanedAt；copy/事务失败不破坏旧引用；删链把 avatar/cover 标 orphaned。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/server test -- tests/chains/chains.appearance.test.ts tests/chains/chains.crud.test.ts tests/media/media-access.test.ts`

Expected: FAIL（新 helper、字段与绑定行为缺失）。

- [ ] **Step 3: 实现纯归一化模块**

`chain-appearance.ts` 使用与 Web 相同的 FNV-1a；focus 写库 `Math.round(clamp(value)*10000)`，读库除以 10000。create 优先级 `avatarMediaId > icon > color > defaultColor`；update 仅在选择器出现时切模式，显式 null 且无新模式回默认纯色；focus 单独更新要求当前对应图片存在，否则抛 `CHAIN_AVATAR_FOCUS_INVALID`/`CHAIN_COVER_FOCUS_INVALID`。

- [ ] **Step 4: 实现事务内绑定与补偿**

`chain-media.ts` 对待绑定 ids `FOR UPDATE`；校验 uploader、ready、`momentId=null`、raster allowlist、users/chains 无其他引用、avatar!=cover。新图片 copy 到：

```ts
const finalKey = `chains/${chainId}/${placement}/${row.id}.${mime.extension(row.mime) || 'bin'}`;
```

返回 `{copies:[{tmpKey,finalKey,storageMeta}], replacedIds:string[]}`。事务提交后删除 tmp；catch 删除本次 final；旧 id 只在新链引用写成功后标 orphaned。相同当前 id 不 copy。

- [ ] **Step 5: 接入 ChainService**

create 预生成 chainId，在一个事务中：锁 media/copy、insert chain、insert owner membership；update owner 鉴权后在一个事务中锁 current chain 与 media、写 patch；事务外围分别调用 cleanup/rollback。`remove` 在删 chain 前将 avatar/cover media 标 orphaned。

`attachPreviews` 批量收集所有 avatar/cover id，一次查询 ready media set；`toChainDto` 只对 ready 关联返回该 placement 的 `mediaId`、`/api/media/${id}` 和 focus，关联缺失或非 ready 时这三项全部返回 null。不得每条链单独查 media。

扩展 `MediaService.resolveAccessUrl`：`momentId=null` 时先查链 avatar/cover 引用；存在则 `ChainPolicy.require(viewer)`，未引用才走 uploader 临时预览。

由于 chains→media 与 media→moments→chains 形成引用环，`resetDb()` 和 e2e `resetFixture()` 在 `delete(media)` 前先执行 `update chains set avatarMediaId=null, coverMediaId=null`；不得只调整 delete 顺序假装消除循环。

- [ ] **Step 6: 更新 fixture 与绿灯**

所有 `ChainDto` fixture 增加 `avatarMediaId/avatarUrl/avatarFocus/coverUrl/coverFocus`；既有创建测试从“color null”改为“持久化哈希预设色”，旧 color+icon 断言改为 icon 非空且 color null。

Run: `pnpm --filter @moment/server test -- tests/chains/chains.appearance.test.ts tests/chains/chains.crud.test.ts tests/media/media-access.test.ts`

Expected: PASS；storage mock 明确断言 copy、tmp cleanup、rollback final cleanup 调用。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/chains/chain-appearance.ts apps/server/src/chains/chain-media.ts apps/server/src/chains/chain.service.ts apps/server/src/media/media.service.ts apps/server/src/e2e/fixture-rows.ts apps/server/src/e2e/fixture-rows.test.ts apps/server/src/e2e/fixture-seeder.ts apps/server/tests/helpers/db.ts apps/server/tests/chains/chains.appearance.test.ts apps/server/tests/chains/chains.crud.test.ts apps/server/tests/media/media-access.test.ts
git commit -m "feat(server): bind chain avatar and cover media"
```

---

### Task 5: Public share — 链头像/封面与 token 媒体访问

**Files:**
- Modify: `apps/server/src/share/share-link.service.ts`
- Modify: `apps/server/src/media/media.service.ts`
- Modify: `apps/server/tests/share/public-share.test.ts`
- Modify: `apps/server/tests/share/share-media.test.ts`

**Interfaces:**
- Consumes Task 1 `PublicShareChainInfo`、Task 4 stable URL/focus。
- Produces有效 share token 下的 chain visual response；`assertShareAccess` 允许同链 Moment media 或 chain avatar/cover。

- [ ] **Step 1: 写红灯测试**

给分享链绑定 ready avatar/cover，断言 `response.chain` 包含稳定 URL、mediaId、focus、color/icon；用 `GET /api/media/:id?st=token` 访问本链两类资源均 302，跨链资源 404，吊销 token 后 404。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/server test -- tests/share/public-share.test.ts tests/share/share-media.test.ts`

Expected: FAIL（query/serializer/assertShareAccess 尚未覆盖 chain assets）。

- [ ] **Step 3: 实现并绿灯**

`getSharedChain` 查询链视觉列并批量确认 media ready；构造与 ChainDto 同语义的稳定 URL/focus。`assertShareAccess` 在 `row.momentId` 为空时查询 `chains.id=link.chainId AND (avatarMediaId=row.id OR coverMediaId=row.id)`；不存在统一 `MEDIA_NOT_FOUND`。

Run: `pnpm --filter @moment/server test -- tests/share/public-share.test.ts tests/share/share-media.test.ts`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/share/share-link.service.ts apps/server/src/media/media.service.ts apps/server/tests/share/public-share.test.ts apps/server/tests/share/share-media.test.ts
git commit -m "feat(server): expose chain appearance in public shares"
```

---

### Task 6: API Client — discard 与上传 mediaId 回调

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `packages/api-client/src/upload.ts`
- Modify: `packages/api-client/src/upload.test.ts`

**Interfaces:**
- Produces `MomentClient.discardMedia(mediaId:string):Promise<void>` → `DELETE /api/media/:id`。
- Produces `UploadMediaInput.onMediaId?: (mediaId:string)=>void`，presign 成功后、PUT 开始前恰好调用一次。

- [ ] **Step 1: 写红灯测试**

api route test 断言 discard 使用 DELETE；upload test 分别覆盖单 PUT 与 multipart，断言 `onMediaId` 在第一次 put 之前收到 presign id，上传失败仍已收到 id，presign 失败不调用。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/api-client exec tsx --test src/client.test.ts src/upload.test.ts`

Expected: FAIL（接口和 callback 不存在）。

- [ ] **Step 3: 最小实现**

在 `UploadMediaInput` 增加 callback，并在 `const presigned = await ...` 后立即：

```ts
input.onMediaId?.(presigned.mediaId);
```

MomentClient interface/实现增加：

```ts
discardMedia: (mediaId) => http.request(`/api/media/${mediaId}`, { method: 'DELETE' }),
```

- [ ] **Step 4: 绿灯、构建与 Commit**

Run: `pnpm --filter @moment/api-client test && pnpm --filter @moment/api-client build && pnpm --filter @moment/api-client lint`

Expected: 全部 exit 0。

```bash
git add packages/api-client/src/client.ts packages/api-client/src/client.test.ts packages/api-client/src/upload.ts packages/api-client/src/upload.test.ts
git commit -m "feat(api-client): support disposable media uploads"
```

---

### Task 7: Web 基础 — 离线 Emoji、草稿模型、焦点编辑器

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/src/chain/appearance-model.ts`
- Create: `apps/web/src/chain/appearance-model.test.ts`
- Create: `apps/web/src/chain/appearance-upload.ts`
- Create: `apps/web/src/chain/appearance-upload.test.ts`
- Create: `apps/web/src/chain/EmojiPickerPanel.tsx`
- Create: `apps/web/src/chain/FocalImageEditor.tsx`
- Create: `apps/web/src/chain/FocalImageEditor.test.tsx`
- Create: `apps/web/src/chain/ChainAppearanceEditor.tsx`
- Create: `apps/web/src/chain/ChainAppearanceEditor.test.tsx`
- Modify: `apps/web/src/lib/chain-color.ts`
- Create: `apps/web/src/lib/chain-color.test.ts`

**Interfaces:**
- Produces `ChainAppearanceDraft`, `ChainImageDraft`, `appearanceDraftFromChain`, `appearanceInputFromDraft`。
- Produces `shiftFocusForDrag`, `focusObjectPosition`。
- Produces `uploadChainImage(api,file,callbacks,signal)`、`discardDraftImage(api,image)`。
- Produces controlled `ChainAppearanceEditor`；不直接访问全局 client。

- [ ] **Step 1: 写纯逻辑红灯测试**

覆盖：ChainDto→三模式草稿；草稿→create/update payload 只激活一个模式；existing media 不 discard、temp media discard；cover 独立；FNV fallback；hex 直接作为 CSS；cover 几何下 `focus.x - dx/excessWidth`、无 overflow 轴回 0.5、两轴 clamp。

核心数学固定为：

```ts
const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
const excessX = imageWidth * scale - viewportWidth;
const excessY = imageHeight * scale - viewportHeight;
const x = excessX > 0 ? clamp(start.x - deltaX / excessX) : 0.5;
const y = excessY > 0 ? clamp(start.y - deltaY / excessY) : 0.5;
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/web test -- appearance-model chain-color FocalImageEditor ChainAppearanceEditor`

Expected: FAIL（新模块不存在）。

- [ ] **Step 3: 安装离线依赖与静态复制**

Run:

```bash
pnpm --filter @moment/web add frimousse@0.3.0
pnpm --filter @moment/web add -D emojibase-data@17.0.0 vite-plugin-static-copy@4.1.1
```

`vite.config.ts` 加 `viteStaticCopy` 三个 target：`node_modules/emojibase-data/zh/data.json`、`zh/messages.json` → `vendor/emojibase/zh`，`node_modules/emojibase-data/LICENSE` → `vendor/emojibase`。不改 package scripts。

- [ ] **Step 4: 实现 model/upload helper**

`ChainImageDraft` 固定包含 `mediaId/src/focus/persisted/status/progress/error/fileName`；`ChainAppearanceDraft` 固定包含 `avatarMode/color/icon/avatar/cover`。`appearanceInputFromDraft` 对 inactive avatar 字段显式传 null，确保服务端切模式；cover 始终传 mediaId/null 和有效 focus。

`uploadChainImage` 只接受注入的 `Pick<MomentClient,'uploadMedia'|'discardMedia'>`，kind 固定 image，透传 AbortSignal/onMediaId/onProgress；因此单测不 mock 全局模块。

- [ ] **Step 5: 实现 Frimousse 面板与编辑器**

`EmojiPickerPanel` 使用真实 0.3 API：

```tsx
<EmojiPicker.Root
  locale="zh"
  emojiVersion={17}
  emojibaseUrl="/vendor/emojibase"
  onEmojiSelect={({ emoji }) => onSelect(emoji)}
>
  <EmojiPicker.Search aria-label="搜索 Emoji" />
  <EmojiPicker.Viewport>
    <EmojiPicker.Loading>正在载入 Emoji…</EmojiPicker.Loading>
    <EmojiPicker.Empty>没有找到 Emoji</EmojiPicker.Empty>
    <EmojiPicker.List
      components={{
        CategoryHeader: ({ category, ...props }) => <div className="bg-bg px-3 py-2 text-caption text-muted" {...props}>{category.label}</div>,
        Row: ({ children, ...props }) => <div className="px-2" {...props}>{children}</div>,
        Emoji: ({ emoji, ...props }) => <button className="flex h-8 w-8 items-center justify-center rounded-surface-md text-lg data-[active]:bg-floating-hover focus-visible:outline-none focus-visible:ring-focus" {...props}>{emoji.emoji}</button>,
      }}
    />
  </EmojiPicker.Viewport>
</EmojiPicker.Root>
```

`ChainAppearanceEditor` 用三个 `aria-pressed` mode button、预设色 + `<input type=color>` + hex Input、图片 file input、独立 cover 区；Emoji panel 通过 `lazy(() => import('./EmojiPickerPanel'))` 按需加载。所有几何只用 4/8 网格和既有 semantic classes。

`FocalImageEditor` 的拖动预览使用 pointer capture；同时提供两个 label 明确的 range（0–100）作为键盘可访问替代，取消恢复初值、确认回传。

- [ ] **Step 6: 绿灯与静态产物验证**

Run: `pnpm --filter @moment/web test -- appearance-model chain-color FocalImageEditor ChainAppearanceEditor appearance-upload`

Run: `pnpm --filter @moment/web build`

Run: `test -f apps/web/dist/vendor/emojibase/zh/data.json && test -f apps/web/dist/vendor/emojibase/zh/messages.json && test -f apps/web/dist/vendor/emojibase/LICENSE`

Expected: tests/build PASS，三个同源静态文件存在。

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/src/chain/appearance-model.ts apps/web/src/chain/appearance-model.test.ts apps/web/src/chain/appearance-upload.ts apps/web/src/chain/appearance-upload.test.ts apps/web/src/chain/EmojiPickerPanel.tsx apps/web/src/chain/FocalImageEditor.tsx apps/web/src/chain/FocalImageEditor.test.tsx apps/web/src/chain/ChainAppearanceEditor.tsx apps/web/src/chain/ChainAppearanceEditor.test.tsx apps/web/src/lib/chain-color.ts apps/web/src/lib/chain-color.test.ts pnpm-lock.yaml
git commit -m "feat(web): add offline chain appearance editor"
```

---

### Task 8: Web 表单接入 — 创建链与链设置

**Files:**
- Modify: `apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.ts`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Create: `apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.test.ts`
- Modify: `apps/web/src/pages/chain-settings/chain-settings.service.ts`
- Modify: `apps/web/src/pages/chain-settings/sections.tsx`
- Create: `apps/web/src/pages/chain-settings/chain-settings.service.test.ts`
- Modify: `apps/web/src/pages/settings-account.test.tsx`
- Delete: `apps/web/src/chain/ChainLookPicker.tsx`
- Modify: `apps/app/src/features/chain-settings/chain-settings.service.ts`
- Modify: `apps/app/src/features/chain-settings/index.tsx`

**Interfaces:**
- Consumes Task 6 client lifecycle、Task 7 draft/editor。
- Produces两页面一致的 `selectAppearanceImage(kind,file)`, `setAvatarMode`, `discardAppearanceImage`, `disposeAppearanceDraft` 行为。

- [ ] **Step 1: 写 service 红灯测试**

创建页覆盖：默认纯色 payload；Emoji payload；avatar+cover 上传完成后 submit 带 ids/focus；上传中禁止 submit；切模式会 abort 并 discard temp；submit 成功后 temp 标 persisted，关闭不误删。

设置页覆盖：从已有 image/emoji/color 水合；现有已绑定图片切模式不提前 DELETE；新 temp 切换会 DELETE；save 返回新 ChainDto 后重新水合；unmount 只清理未保存 temp。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/web test -- create-chain-dialog.service chain-settings.service settings-account`

Expected: FAIL（appearance state/method 未接入）。

- [ ] **Step 3: 实现 race-safe 上传状态**

两 service 每个 placement 持有 generation 与 AbortController。选择文件时先递增 generation、撤销旧 object URL、创建本地 preview；`onMediaId` 若 generation 已过期则立即 `discardMedia(id)`，否则写入草稿。完成回调只在 generation 仍相等时置 ready；catch 的 ABORTED 不显示失败，其他错误置 error。切换/卸载递增 generation并 abort，temp id best-effort discard。

保存按钮条件固定为：name 非空、avatar/cover 均非 uploading、image 模式下 avatar status=ready 且 mediaId 非空。

- [ ] **Step 4: 替换 UI 并保持 Rab 分层**

两个页面只把 service 草稿和 action callback 传给 `ChainAppearanceEditor`；组件不 import client。设置页保存成功 toast 保留，错误继续从 `$model.saveProfile.error` 进入 Banner。创建成功后先把草稿标 persisted，再 close/navigate。

删除旧 `ChainLookPicker.tsx` 并清理 imports。

RN 不增加图片/封面入口，只做部署兼容：链表单颜色值显式使用 `ChainAppearanceColor`（不改用户头像的 `ChainColor`）；颜色按钮选择时同时 `formIcon=null`；选择 Emoji 时保留选择但 save 允许 Server 归一化，现有功能不因新 DTO 互斥而失效。

- [ ] **Step 5: 绿灯与构建**

Run: `pnpm --filter @moment/web test -- create-chain-dialog.service chain-settings.service settings-account`

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/app typecheck`

Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.ts apps/web/src/shell/create-chain-dialog/index.tsx apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.test.ts apps/web/src/pages/chain-settings/chain-settings.service.ts apps/web/src/pages/chain-settings/sections.tsx apps/web/src/pages/chain-settings/chain-settings.service.test.ts apps/web/src/pages/settings-account.test.tsx apps/web/src/chain/ChainLookPicker.tsx apps/app/src/features/chain-settings/chain-settings.service.ts apps/app/src/features/chain-settings/index.tsx
git commit -m "feat(web): integrate chain appearance forms"
```

---

### Task 9: Web 展示 — ChainMark、链首页封面与公开分享

**Files:**
- Modify: `apps/web/src/chain/ChainMark.tsx`
- Create: `apps/web/src/chain/ChainMark.test.tsx`
- Create: `apps/web/src/chain/ChainCover.tsx`
- Create: `apps/web/src/chain/ChainCover.test.tsx`
- Modify: `apps/web/src/media/useMediaObjectUrl.ts`
- Create: `apps/web/src/media/useMediaObjectUrl.test.tsx`
- Modify: `apps/web/src/shell/chain-nav-list.tsx`
- Modify: `apps/web/src/pages/feed-home/index.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`
- Modify: `apps/web/src/timeline/moment-sheet.tsx`
- Modify: `apps/web/src/memories/memories-entry.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/pages/share-album/index.tsx`
- Modify: `apps/web/src/pages/chain-home/chain-home.test.tsx`
- Modify: `apps/web/src/pages/timeline-variants.test.tsx`
- Modify: `apps/web/src/memories/memories-entry.test.tsx`
- Modify: `apps/web/src/services/chain-list.service.test.ts`
- Modify: `apps/web/src/shell/chain-nav-list.test.tsx`
- Modify: `apps/web/src/shell/shell-navigation.test.tsx`
- Modify: `apps/web/src/pages/settings-account.test.tsx`

**Interfaces:**
- `ChainMark` 新 props：`avatarMediaId`, `avatarSrc`, `avatarFocus`；内部始终调用 `useMediaObjectUrl(avatarMediaId ?? null)`，public 用 `avatarSrc`。
- `ChainCover` 登录版接 mediaId/焦点；`PublicChainCover` 接稳定 URL/shareToken/焦点。

- [ ] **Step 1: 写展示红灯测试**

测试图片优先、Emoji、custom color、id fallback、图片 onError 回退、focus→object-position。Cover 测试登录态使用 mocked Blob hook，public src 必须为 `${url}?st=${encodeURIComponent(token)}`。`useMediaObjectUrl` 测试同一 mediaId 同时挂载 20 个消费者只发一次 `fetchMediaBlob`，最后一个卸载才 revoke URL。页面测试断言 cover 只存在 chain-home/share-album；nav/timeline/memories 只出现 avatar。

- [ ] **Step 2: 运行红灯**

Run: `pnpm --filter @moment/web test -- ChainMark ChainCover chain-home timeline-variants memories-entry chain-nav-list shell-navigation`

Expected: FAIL（新 props/component/fixture fields 缺失）。

- [ ] **Step 3: 实现 ChainMark/ChainCover**

`ChainMark` source 优先 `avatarSrc ?? blobUrl`；src 变化重置 broken state；`img` 使用圆形 cover 与 `focusObjectPosition`。图片 loading/error 时走 `icon ?? color ?? hash`。Emoji 背景固定 `var(--surface)`；hex 通过 `chainColorCss`，预设通过 token map。

把 `useMediaObjectUrl` 改成模块级 `Map<mediaId,{promise,url,refs,listeners}>`：首个消费者 fetch/createObjectURL，后续订阅同一 promise/url；最后一个消费者卸载后 revoke 并删除 entry。fetch 失败通知 null 并移除 entry，保证后续渲染可以重试。这样汇总时间线 50 条同链 Moment 不会重复下载同一头像。

`ChainCover` 共用无状态 `CoverImage`，宽幅容器用已有 radius/surface token，`object-fit:cover`；登录版 `useMediaObjectUrl`，公开版追加 st；错误回调隐藏整个封面，让页面回普通 header。

- [ ] **Step 4: 贯通头像数据**

`chainLookById` value 扩成：

```ts
{
  name: string;
  color: ChainAppearanceColor | null;
  icon: ChainIcon | null;
  avatarMediaId: string | null;
  avatarFocus: ChainImageFocus | null;
}
```

Shell/nav、feed Timeline、MomentSheet、Memories 全部透传 avatar 字段；不透传 cover。

Chain home header 在标题上方/后方渲染登录 `ChainCover`；公开分享 header 同时渲染 public avatar mark 与 public cover。页面无 cover 时 DOM 结构保持当前布局。

- [ ] **Step 5: 更新所有 ChainDto fixtures**

对 `rg -l 'coverMediaId:' apps/web/src --glob '*.{ts,tsx}'` 返回的每个 fixture 增加五个新字段；图片 fixture 使用合法 `/api/media/...` 和 `{x:0.5,y:0.5}`，其余用 null。不要把响应字段设为 optional 来规避 fixture 更新。

- [ ] **Step 6: 绿灯、typecheck 与 Commit**

Run: `pnpm --filter @moment/web test -- ChainMark ChainCover chain-home timeline-variants memories-entry chain-nav-list shell-navigation settings-account`

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`

Expected: 全部 exit 0。

```bash
git add apps/web/src/chain/ChainMark.tsx apps/web/src/chain/ChainMark.test.tsx apps/web/src/chain/ChainCover.tsx apps/web/src/chain/ChainCover.test.tsx apps/web/src/media/useMediaObjectUrl.ts apps/web/src/media/useMediaObjectUrl.test.tsx apps/web/src/shell/chain-nav-list.tsx apps/web/src/shell/chain-nav-list.test.tsx apps/web/src/shell/shell-navigation.test.tsx apps/web/src/pages/feed-home/index.tsx apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/chain-home/chain-home.test.tsx apps/web/src/pages/share-album/index.tsx apps/web/src/pages/timeline-variants.test.tsx apps/web/src/pages/settings-account.test.tsx apps/web/src/timeline/timeline.tsx apps/web/src/timeline/moment-sheet.tsx apps/web/src/memories/memories-entry.tsx apps/web/src/memories/memories-entry.test.tsx apps/web/src/services/chain-list.service.test.ts
git commit -m "feat(web): render chain avatars and covers"
```

---

### Task 10: 全仓回归、迁移安全与 CSI 验收

**Files:**
- Modify only if verification reveals a requirement gap: the exact failing source/test file; never weaken assertions.
- Do not add generated CSI screenshots, browser downloads, `apps/web/dist`, or `.superpowers/brainstorm/**` to git.

**Interfaces:**
- Consumes all prior tasks。
- Produces verified workspace commit set ready for branch finishing/push。

- [ ] **Step 1: 静态与单元全回归**

Run:

```bash
pnpm --filter @moment/dto test
pnpm --filter @moment/api-client test
pnpm --filter @moment/web test
pnpm --filter @moment/dto build
pnpm --filter @moment/api-client build
pnpm --filter @moment/web build
pnpm --filter @moment/app typecheck
pnpm --filter @moment/server typecheck
```

Expected: 全部 exit 0，0 failed tests。

- [ ] **Step 2: Server 触库与存储 mock 回归**

再次确认 `.env` 是测试库后：

Run: `pnpm --filter @moment/server test`

Expected: Jest `--runInBand` 全绿；默认不运行真实 S3 smoke。

- [ ] **Step 3: 启动应用并用 CSI 验收**

在真实 Chrome 完成：

1. 创建纯色、Emoji、图片头像链；刷新后保持。
2. 上传头像和封面，调整两者焦点；宽屏/窄屏主体位置正确。
3. 设置页三模式往返；上传中保存禁用；失败重试/删除可用。
4. 侧栏、顶部 chips、汇总时间线、“那年今日”只显示头像；链首页显示封面。
5. 公开分享页显示对应头像/封面；跨链媒体不可读；吊销链接后 public API/media 都失败。
6. CSI `network start/list` 包围 Emoji picker 打开与搜索，断言请求 host 只有 Moment 同源，路径命中 `/vendor/emojibase/zh/data.json`、`messages.json`，不存在 `cdn.jsdelivr.net`/`liveblocks.io`。
7. DevTools 模拟 offline 后重新打开已缓存 Emoji picker，确认缓存命中；冷缓存 offline 显示明确加载态而不是破坏整个表单。

- [ ] **Step 4: 存储与 DB 证据**

通过测试/日志确认 tmp→`chains/{id}/avatar|cover` copy、提交后 tmp cleanup、替换旧 media 的 `orphanedAt`、discard 与两个 sweeper。不得直接删除真实用户桶对象作为验收手段。

- [ ] **Step 5: 最终 diff 与提交**

Run: `git diff --check && git status --short && git log --oneline -12`

Expected: 无格式错误；工作区没有本计划之外的意外改动（评审临时目录 `.superpowers/brainstorm/**` 仍保持未跟踪且不提交）；每个 Task 有独立 conventional commit。

若 Step 1–4 为修复验证问题产生了改动，只暂存 `git status --short` 中本轮实际修改、且归属于本计划文件表的精确路径；复跑对应失败命令后提交 `fix: close chain appearance verification gaps`，不得用 `git add .`。

最后使用 `superpowers:verification-before-completion` 重新运行与声明对应的完整验证命令，再进入 `superpowers:finishing-a-development-branch`。
