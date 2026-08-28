# 时刻人物与地点 P5：api-client persons 资源 + web 编辑器（人物选择器 / 地点 / EXIF 读取）+ 卡片展示 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「时刻人物与地点」的 web 端闭环：`@moment/api-client` 增加 persons 资源封装（list/create/rename/remove，对齐 P2 API 契约的幂等 create 返回形态）并确认 moments create/update 的 personIds/place 类型经 dto 增量直达；web 发布编辑器加**人物选择器**（chip 多选 + 链成员置顶 + 词典搜索 + 自由文本回车新建幂等 POST + AI 角标）与**地点输入**（文本框 + EXIF chip）；EXIF GPS 在 compose 流程内**客户端解码**（`file.slice(0, 256KB)` + 动态 import exifreader，失败静默）；`personIds`/`place` 走 **dirty tracking**（undefined = 不变、`place: null` = 显式清除，对齐 timeEdited 判脏先例）；时刻卡片/详情加人物 chip 行与地点行（只读、不可点——点击过滤属 M2）。

**Architecture:** api-client 不重复定义类型——persons 的请求/响应类型全部从 `@moment/dto` 引用（P1 Produces），moments 的 personIds/place 增量经既有 `ZodInput<typeof createMomentInputSchema>` 与 `PatchMomentInput` 类型**自动直达**，api-client 只加四个 persons 方法。web 侧状态三层遵守 `apps/web/CLAUDE.md`：人物/地点草稿全部进组件级 `ComposePanelService`（与 selectedTags 同层），选择器 UI 是同目录 props-driven observer 组件（镜像 `template-fields.tsx` 的 `service` prop 范式）；EXIF 解析是 `src/compose/exif-gps.ts` 纯工具（动态 import exifreader，compose 流程外零加载体积，先例 `ChainAppearanceEditor.tsx` 的 EmojiPickerPanel 懒加载）；卡片展示改 `moment-sheet.tsx` 单点（feed / 链时间线 / 详情页共用），公开分享路径经 `PublicShareMoment` 类型层天然不含 persons/place（spec §8 红线在 UI 层生效）。

**Tech Stack:** React 19 + Vite 7 + @rabjs/react（Service/observer）/ react-aria-components（Field 家族）/ lucide-react / exifreader `^4.44.0`（2026-08-28 npm 最新 4.44.0，pin major 4）/ Vitest 4 + jsdom + @testing-library/react（web 既有组件测试范式）/ api-client 测试 tsx --test（node:test，既有 fetch harness）。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§3 客户端 EXIF 提取·web 端小节与安全信任边界、§6 API 设计与客户端提交纪律、§7 各端 UX、§8 隐私红线、§9 测试策略·web 条目、§11 P5 出口标准）

**上游契约:**
- P1：`docs/superpowers/plans/2026-08-28-people-place-p1-dto-schema.md`（dto 全部符号，逐字消费）
- P2：`docs/superpowers/plans/2026-08-28-people-place-p2-server-persons.md`（persons API 契约：POST 幂等新建 201/命中 200 且 body 同形、PATCH 撞名 409 `PERSON_NAME_CONFLICT`、DELETE 204、错误码 `PERSON_NOT_IN_CHAIN` / `PERSON_NOT_FOUND` / `PERSON_USER_NOT_IN_CHAIN`；`MomentResponse.persons/place` 必填化 + `PublicShareMoment`）
- 执行编排：`docs/superpowers/prompts/2026-08-28-people-place-execution.md` T5 节 + §1 M1 硬约束（EXIF 只在前端解码 / dirty tracking / source server 赋值）

## Global Constraints（只写本计划新增，通用约束继承编排 §1）

- **UI 严格从六份 C 端设计规范选既有组件/模式，不新增设计 token、不另立样式**（`.claude/rules/web-ui.md`）：chip 复用 `apps/web/src/compose/template-fields.tsx` 既有 `CHIP_BASE/CHIP_ON/CHIP_OFF`（`rounded-full` + `text-caption` + `border-line` / 选中 `bg-select text-select-fg`，类名逐字一致，不新增 token）；地点文本框走 Field 家族 `TextField`（`2026-08-18-web-field-input-design.md` §2.2/§8）；EXIF chip 移除走 `IconButton`（`2026-08-18-web-button-design.md`，IconButton 既有导出）；AI 角标悬停提示走 `ui/tooltip` 的 `Tooltip`（`2026-08-18-web-menu-popover-tooltip-design.md` §9，只解释陌生控件的短纯文本）；错误反馈走既有 `Banner`/`humanError`（`2026-08-18-web-feedback-design.md`）。间距只用 4/8/12/16/20/24/32 档位。
- **EXIF 只在前端解码**（spec §3）：`file.slice(0, 256 * 1024).arrayBuffer()` → 动态 `import('exifreader')` → `load(buffer, { expanded: true })` 取 `gps` 组十进制坐标；解析失败**静默**（不提示错误）；多图取**第一张含 GPS 的**；服务端永不读对象字节（本计划不触 server）。
- **客户端提交纪律（dirty tracking）**（spec §6）：`personIds`/`place` 仅用户实际修改才进 payload——`undefined` = 不变（键完全不出现在请求体）；`place: null` = 显式清除；`tagIds` 保持既有全量提交范式**不动**。判脏对齐 `timeEdited` 先例（`compose-panel.service.ts` submit 内 `timeEdited` 的条件 spread 范式）。
- **source 只能 server 赋值**（spec §3/§6）：web 任何请求不携带 source；EXIF 路只提交坐标 `{lat, lng}`（无 name，落 exif 分支，name 由 geocode 异步回填）；`PersonBrief.source` 仅用于展示（AI 角标），提交的 personIds 只有 id。
- **隐私红线在展示层生效**（spec §8）：卡片展示经 `MomentSheetMoment = PublicShareMoment & { persons?: PersonBrief[]; place?: MomentPlace | null }` 可选形态——公开分享路径（PublicShareMoment，两键不存在）自然不渲染人物/地点行。
- 工程门禁顺序：改 `packages/api-client` 后必须 `pnpm --filter @moment/api-client build` 再跑 web 测试（web 经 workspace `exports` 消费 dist）；跑任何测试前先 `pnpm build`（dto 等依赖包先构建）。
- 每 Task 一个 commit（conventional commits，`feat(api-client)` / `feat(web)`）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **EXIF 十进制与 S/W 取负交由 exifreader 的 expanded `gps` 组预计算值**：spec §3 字面是「GPS 字段转十进制（注意 S/W 半球取负）」。已核实 exifreader 4.44.0 源码（`src/exif-reader.js`：`gps.Latitude = getCalculatedGpsValue(GPSLatitude.value)`，且 `GPSLatitudeRef === 'S'` / `'W'` 时取负；类型 `GpsTags = { Latitude?: number; Longitude?: number; Altitude?: number }`）——预计算值与手工 DMS 换算**结果等价**，且类型层零 cast。本计划消费 `tags.gps.Latitude/Longitude` 并做范围/有限性防御（越界视为脏数据静默丢弃）；S/W 负号行为由测试 fixture（手写最小 JPEG EXIF APP1 段）钉死两条用例。P6（app）不走 exifreader（expo 扁平键），app 侧手工换算属 P6 范围。
2. **EXIF 自动回填的覆盖规则（spec 未规定）钉死**：仅在地点草稿**完全为空**（`placeName` 为空 && `placeCoords` 为 null）时写入；用户点 × 移除 chip 后置 `exifDismissed`，**本面板会话内不再自动回填**（否则移除后加下一张图会复活，chip「删不掉」）；已手动输入地点名的照片不补坐标（manual > exif 优先级在编辑器层的体现）。
3. **personIds 判脏是「用户动作级」而非「集合对比」**：任一增删人物动作（toggle chip / 回车新建 / 选链成员）即置 `personsTouched`，提交当前选中全集。理由：spec §5 冲突规则「用户在编辑器里重新加回同一 person → 该行 source 升级 manual」——删除后加回的 id 集合与基线**相同**，集合对比会漏提交、升级永不发生；动作级判脏才能承载该语义。提交的全集写 manual 是 API 既有语义（P2），未被单独触碰的行随全集升级，spec §6「提交的 id 集合写 source=manual」字面允许。
4. **place 判脏后提交完整展示态**：用户改过地点（`placeTouched`）即提交 `placePayload()`——有坐标（无论来自 EXIF chip 还是编辑回读）带坐标、有名字带名字（截断首尾空白），两者皆空 → `null`。结果落在赋值表：坐标+名字 → manual（「客户端确认后的形态」行）、仅名字 → manual、null → 清空。未动过（undefined）则 EXIF 坐标 + geocode 回填名绝不整包回传（spec §6 警告的 exif 误升级场景）。spec 未规定「改过名字后坐标是否随行」，钉死为随行（仅提交名字会触发「仅名字 → manual 且坐标清空」，丢数据更差）。
5. **web 提交前对 place.name 做 trim**：P1 偏差 5 规定 dto 不 trim（名义值原样入库）；但纯空白名提交必 400（`min(1)`），web 以 trim 后空串判定「无名字」，提交 trim 后的值。这是提交纪律，不改 dto 契约。
6. **词典搜索是全量 GET + 前端过滤**：spec §7「词典搜索（GET persons）」——server 的 `GET /api/chains/:chainId/persons` 无搜索参数（P2 契约），且单链词典数十量级（spec §10 容量假设），钉死为面板打开时全量拉取、输入即前端 `includes` 过滤。
7. **链成员置顶的选中语义**：选中链成员 = 先在词典中找 `userId === member.userId` 的 person（含已选集合），命中直接选；未命中幂等 `POST /persons {name: member.nickname, userId: member.userId}`（P2 幂等 + `PERSON_USER_NOT_IN_CHAIN` 校验天然安全——userId 必是本链成员）再选。词典展示区**过滤掉已由链成员 chip 代表的 user_id 链接行**（避免同名双 chip）。spec §7「选中即建/复用 user_id 链接的 person」的钉死实现。
8. **`moment-sheet.tsx` 引入 `MomentSheetMoment`，`openCompose` 传 `edit: moment as MomentResponse`**：P2 已把 moment-sheet 的 props 放宽为 `PublicShareMoment`（分享页与链内页共用组件链）；P5 展示 persons/place 需要可选形态（偏差见隐私红线约束）。`ComposeRequest.edit?: MomentResponse` 保持不变，`openCompose` 处加 cast——运行时非 `readOnly` 路径（分享页 readOnly、无编辑入口）必为链内完整 `MomentResponse`，类型收窄是展示层的，不改变数据流。
9. **展示层 place 行只显示 `name`**：`place.name === null`（exif 坐标待 geocode 回填）不显示地点行——裸坐标对家庭用户无意义，spec 未规定坐标裸显形态。地点行样式镜像 moment-sheet 既有 payload.geo 行（`text-meta text-muted` + 📍 前缀，`moment-sheet.tsx` 既有实现）。
10. **人物 chip 行复用词表 chip 形状（非交互 span）**：spec §7「人物 chip 行与地点行只读展示……v1 不可点」——渲染为 `rounded-full border border-line px-3 py-1 text-caption text-ink` 的 span（与编辑器未选中 chip 同形），无 button 语义、无 hover 交互；AI 行角标为 chip 内 `text-muted` 的「AI」小字。
11. **编辑回读的坐标 chip 文案与 EXIF 相同**（「已从照片读取位置」）：v1 全端无地图选点器（spec §7 明确不做），坐标唯一来源是 EXIF——编辑回读的 `place.lat/lng` 必来自照片，文案不区分 source。
12. **`loadPersons` 失败静默**：人物选择器是辅助输入，加载失败保持空列表、不阻塞发布主流程（对齐 `loadManifest` 失败静默先例）；但 `submitPersonQuery`/`toggleMember` 的 POST 失败走 `humanError` 写 `error`（面板 Banner，既有错误通道）。

---

### Task 1: api-client persons 资源封装 + moments personIds/place 类型确认

**Files:**
- Modify: `packages/api-client/src/client.ts`（import 增 dto persons 类型 + `MomentClient` 接口四个方法 + 实现）
- Test: `packages/api-client/src/client.test.ts`（追加两个 test）

**Interfaces:**
- Consumes（P1/P2 Produces 逐字引用）:
  - `@moment/dto`：`PersonCreateInput`（`{name: trim 1..50, userId?: uuid}`）、`PersonPatchInput`（`{name: trim 1..50}`）、`PersonResponse`（`{id, name, userId}`）、`PersonListResponse`（`{persons: PersonResponse[]}`）
  - P2 API 契约：`GET /api/chains/:chainId/persons`（viewer）、`POST /api/chains/:chainId/persons`（editor，新建 201 / 幂等命中 200，**body 同形**）、`PATCH /api/chains/:chainId/persons/:personId`（editor）、`DELETE /api/chains/:chainId/persons/:personId`（editor，204）
  - 既有 `Http.request`（`packages/api-client/src/http.ts`，204 空 body → undefined，`deleteTag` 同范式）
  - 既有 `CreateMomentInput = ZodInput<typeof createMomentInputSchema>`（P1 后 schema 已含 `personIds`/`place`，类型自动直达）、`PatchMomentInput`（dto re-export，P1 后已含两键）——**本 Task 无需改 moments 代码，只加测试钉死**
- Produces（P5 后续 Task / P6 消费）:
  - `MomentClient.listPersons(chainId: string): Promise<PersonListResponse>`
  - `MomentClient.createPerson(chainId: string, input: PersonCreateInput): Promise<PersonResponse>`（幂等 create 的 201/200 不区分——两者 body 同形，调用方按需重拉词典）
  - `MomentClient.renamePerson(chainId: string, personId: string, input: PersonPatchInput): Promise<PersonResponse>`
  - `MomentClient.removePerson(chainId: string, personId: string): Promise<void>`
  - 行为契约（P6 镜像）：`createMoment`/`updateMoment` 请求体可携带 `personIds?: string[]`（uuid ≤ 20）与 `place?: {name?, lat?, lng?} | null`（create 经 `createMomentInputSchema.parse` 校验；update 直传 body，undefined 键不出现）

- [ ] **Step 1: 写失败测试**

Modify `packages/api-client/src/client.test.ts` — 文件末尾追加：

```ts
test('persons 资源路由与 body（people-place P2 契约；幂等 create 201/200 body 同形，client 不区分）', async () => {
  const { client, calls } = harness();
  await client.listPersons('c1');
  await client.createPerson('c1', { name: '外婆' });
  await client.createPerson('c1', { name: '爸爸', userId: 'u1' });
  await client.renamePerson('c1', 'p1', { name: '姥姥' });
  await client.removePerson('c1', 'p1');
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET http://x/api/chains/c1/persons',
    'POST http://x/api/chains/c1/persons',
    'POST http://x/api/chains/c1/persons',
    'PATCH http://x/api/chains/c1/persons/p1',
    'DELETE http://x/api/chains/c1/persons/p1',
  ]);
  assert.deepEqual(calls[1]!.body, { name: '外婆' });
  assert.deepEqual(calls[2]!.body, { name: '爸爸', userId: 'u1' });
  assert.deepEqual(calls[3]!.body, { name: '姥姥' });
});

test('moments create/update 携带 personIds/place（P1 dto 增量经 ZodInput/PatchMomentInput 类型直达，api-client 不改写）', async () => {
  const { client, calls } = harness();
  await client.createMoment('c1', {
    type: 'text',
    content: 'hi',
    happenedAt: '2026-08-16T02:00:00.000Z',
    happenedTzOffset: -480,
    personIds: ['123e4567-e89b-12d3-a456-426614174000'],
    place: { lat: 39.9042, lng: 116.4074 },
  });
  await client.updateMoment('m1', { personIds: [], place: null });
  const createBody = calls[0]!.body as { personIds?: string[]; place?: unknown };
  assert.deepEqual(createBody.personIds, ['123e4567-e89b-12d3-a456-426614174000']);
  assert.deepEqual(createBody.place, { lat: 39.9042, lng: 116.4074 });
  assert.deepEqual(calls[1]!.body, { personIds: [], place: null });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/api-client test`
Expected: FAIL——第一个新测试 `client.listPersons is not a function`；第二个新测试 `client.createMoment` 请求体经 zod parse 后 `personIds`/`place` 被 strip（P1 dto 已落地则 parse 保留、测试可能已绿——此时红灯以第一个测试为准；两路至少一路红才进 Step 3）。

- [ ] **Step 3: 实现 persons 资源**

Modify `packages/api-client/src/client.ts`：

(a) dto 类型 import 块（`import type { ... } from '@moment/dto';`）中，按字母序插入 `PatchMomentInput` 之后的 `PersonCreateInput,`、`PersonListResponse,`、`PersonPatchInput,`、`PersonResponse,`（紧跟既有 `PatchMomentInput, // 等价映射…` 注释行之后）：

```ts
  PatchMomentInput, // 等价映射（依赖契约段免责条款）：…（既有注释行保持不变）
  PersonCreateInput,
  PersonListResponse,
  PersonPatchInput,
  PersonResponse,
```

(b) `MomentClient` 接口中，`deleteTag(tagId: string): Promise<void>;` 之后追加：

```ts
  /** 链 person 词典（编辑器选择器数据源，spec people-place §6；词典行无 source 概念） */
  listPersons(chainId: string): Promise<PersonListResponse>;
  /** 幂等创建（spec people-place §6）：新建 201 / 名归一化撞 uk 返回已存在行 200，两者 body 同形——返回值不区分，调用方按需重拉词典 */
  createPerson(chainId: string, input: PersonCreateInput): Promise<PersonResponse>;
  renamePerson(chainId: string, personId: string, input: PersonPatchInput): Promise<PersonResponse>;
  removePerson(chainId: string, personId: string): Promise<void>;
```

(c) 实现——`deleteTag: (tagId) => ...` 行之后追加（镜像 tags 三行的写法）：

```ts
    listPersons: (chainId) => http.request(`/api/chains/${chainId}/persons`),
    createPerson: (chainId, input) =>
      http.request(`/api/chains/${chainId}/persons`, { method: 'POST', body: input }),
    renamePerson: (chainId, personId, input) =>
      http.request(`/api/chains/${chainId}/persons/${personId}`, { method: 'PATCH', body: input }),
    removePerson: (chainId, personId) =>
      http.request(`/api/chains/${chainId}/persons/${personId}`, { method: 'DELETE' }),
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/api-client test`
Expected: PASS，新增 2 个测试全过，既有测试无回归。

- [ ] **Step 5: 门禁 + 构建（web 后续 Task 消费 dist）**

Run: `pnpm --filter @moment/api-client typecheck && pnpm --filter @moment/api-client lint && pnpm --filter @moment/api-client build`
Expected: 全部 exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/api-client/src/client.ts packages/api-client/src/client.test.ts
git commit -m "feat(api-client): add persons resource and cover moment personIds/place payload"
```

---

### Task 2: exifreader 依赖 + EXIF GPS 解析工具

**Files:**
- Modify: `apps/web/package.json`（dependencies 增 `exifreader`）
- Create: `apps/web/src/compose/exif-gps.ts`
- Test: `apps/web/src/compose/exif-gps.test.ts`

**Interfaces:**
- Consumes:
  - `exifreader`（新依赖，`^4.44.0`）：`load(data: ArrayBuffer, options: { expanded: true }): ExpandedTags`（同步重载），`ExpandedTags.gps?: { Latitude?: number; Longitude?: number; ... }`（十进制、S/W 已取负——已核实 4.44.0 源码与 `exif-reader.d.ts`）
  - 既有动态 import 先例：`apps/web/src/chain/ChainAppearanceEditor.tsx`（EmojiPickerPanel 懒加载，compose 流程外零加载体积的同型做法）
- Produces（Task 3 / P6 消费）:
  - `interface GpsCoords { lat: number; lng: number }`
  - `extractGpsCoords(tags: ExpandedTags): GpsCoords | null`（纯函数：缺 Latitude/Longitude、非有限数、越界 lat ∉ [-90,90] / lng ∉ [-180,180] → null）
  - `parseExifGps(buffer: ArrayBuffer): Promise<GpsCoords | null>`（动态 import exifreader；任何异常 → null，静默）
  - `readGpsFromFile(file: File): Promise<GpsCoords | null>`（非 `image/*` → null；`file.slice(0, 256 * 1024).arrayBuffer()` 后委托 parseExifGps）
  - `firstGps(files: readonly File[]): Promise<GpsCoords | null>`（多图取第一张含 GPS 的，其余忽略——spec §3）
  - **行为契约（P6 镜像语义）**：EXIF 解析只读文件头 256KB、不做像素解码；失败/无 GPS/越界一律静默 null，绝不抛错、不提示；S/W 半球坐标为负数。

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @moment/web add exifreader@^4.44.0`
Expected: `apps/web/package.json` dependencies 出现 `"exifreader": "^4.44.0"`（pin major 4；2026-08-28 npm 最新为 4.44.0）。

- [ ] **Step 2: 写失败测试**

Create `apps/web/src/compose/exif-gps.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { extractGpsCoords, firstGps, parseExifGps, readGpsFromFile } from './exif-gps';

/**
 * 手写最小 JPEG + EXIF APP1（GPS IFD）fixture（spec people-place §9：EXIF 解析函数用
 * 含 GPS 的 fixture buffer 单测）。TIFF 小端布局（字节偏移）：
 *   0x00 'II' + 0x2A + IFD0 offset 8 → IFD0@0x08（1 entry：GPSInfo IFD pointer 0x8825
 *   → 0x1A）→ GPS IFD@0x1A（4 entries，tag 升序 1/2/3/4：LatRef 内联 ASCII、Lat RATIONAL
 *   → 0x50、LngRef 内联、Lng RATIONAL → 0x68）→ 0x50/0x68 各 3 个 RATIONAL（×100/100 保两位小数）。
 */
function buildGpsJpeg(
  latDms: [number, number, number],
  latRef: 'N' | 'S',
  lngDms: [number, number, number],
  lngRef: 'E' | 'W',
): ArrayBuffer {
  const tiff = new ArrayBuffer(0x80);
  const view = new DataView(tiff);
  const bytes = new Uint8Array(tiff);

  const writeAscii = (offset: number, tag: number, s: string) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 2, true); // ASCII
    view.setUint32(offset + 4, s.length + 1, true); // count 含终止符
    for (let i = 0; i < 4; i++) bytes[offset + 8 + i] = i < s.length ? s.charCodeAt(i) : 0;
  };
  const writeRationalOffset = (offset: number, tag: number, valueOffset: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 5, true); // RATIONAL
    view.setUint32(offset + 4, 3, true);
    view.setUint32(offset + 8, valueOffset, true);
  };
  const writeRationals = (offset: number, dms: [number, number, number]) => {
    dms.forEach((v, i) => {
      view.setUint32(offset + i * 8, Math.round(v * 100), true);
      view.setUint32(offset + i * 8 + 4, 100, true);
    });
  };

  // TIFF header（little endian）
  bytes.set([0x49, 0x49], 0);
  view.setUint16(2, 0x2a, true);
  view.setUint32(4, 8, true);
  // IFD0：仅一个 GPSInfo IFD pointer（0x8825）
  view.setUint16(8, 1, true);
  view.setUint16(0x0a, 0x8825, true);
  view.setUint16(0x0c, 4, true); // LONG
  view.setUint32(0x0e, 1, true);
  view.setUint32(0x12, 0x1a, true); // GPSInfo 指针 value：entry 自 0x0a 起（tag 2 + type 2 + count 4），value 在 0x12
  view.setUint32(0x16, 0, true); // next IFD：1 个 entry（12 字节）之后，即 0x16
  // GPS IFD
  view.setUint16(0x1a, 4, true);
  writeAscii(0x1c, 0x0001, latRef);
  writeRationalOffset(0x28, 0x0002, 0x50);
  writeAscii(0x34, 0x0003, lngRef);
  writeRationalOffset(0x40, 0x0004, 0x68);
  view.setUint32(0x4c, 0, true); // next IFD
  writeRationals(0x50, latDms);
  writeRationals(0x68, lngDms);

  const jpeg = new ArrayBuffer(12 + tiff.byteLength);
  const jv = new DataView(jpeg);
  const jb = new Uint8Array(jpeg);
  jb.set([0xff, 0xd8, 0xff, 0xe1], 0); // SOI + APP1 marker
  jv.setUint16(4, 2 + 6 + tiff.byteLength, true); // 段长（含自身 2 字节）
  jb.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // 'Exif\0\0'
  jb.set(new Uint8Array(tiff), 12);
  return jpeg;
}

describe('parseExifGps（spec people-place §3 web 端）', () => {
  it('N/E 半球 → 正十进制（39°54\'15.12" / 116°24\'26.64"）', async () => {
    const buf = buildGpsJpeg([39, 54, 15.12], 'N', [116, 24, 26.64], 'E');
    const coords = await parseExifGps(buf);
    expect(coords).not.toBeNull();
    expect(coords!.lat).toBeCloseTo(39.9042, 4);
    expect(coords!.lng).toBeCloseTo(116.4074, 4);
  });

  it('S/W 半球 → 取负（spec §3：S/W 半球取负）', async () => {
    const buf = buildGpsJpeg([33, 52, 7.68], 'S', [151, 12, 33.48], 'W');
    const coords = await parseExifGps(buf);
    expect(coords!.lat).toBeCloseTo(-33.8688, 4);
    expect(coords!.lng).toBeCloseTo(-151.2093, 4);
  });

  it('无 EXIF 的 JPEG（SOI+EOI）→ null（静默）', async () => {
    const buf = new ArrayBuffer(4);
    new Uint8Array(buf).set([0xff, 0xd8, 0xff, 0xd9]);
    expect(await parseExifGps(buf)).toBeNull();
  });

  it('垃圾字节 → null（解析失败静默，不抛错，spec §3）', async () => {
    expect(await parseExifGps(new ArrayBuffer(64))).toBeNull();
  });
});

describe('readGpsFromFile / firstGps', () => {
  it('image/* File 走切片解析；非 image → null', async () => {
    const buf = buildGpsJpeg([39, 54, 15.12], 'N', [116, 24, 26.64], 'E');
    const coords = await readGpsFromFile(new File([buf], 'a.jpg', { type: 'image/jpeg' }));
    expect(coords?.lat).toBeCloseTo(39.9042, 4);
    expect(await readGpsFromFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBeNull();
  });

  it('多图取第一张含 GPS 的，其余忽略（spec §3）', async () => {
    const withGps = buildGpsJpeg([39, 54, 15.12], 'N', [116, 24, 26.64], 'E');
    const noExif = new ArrayBuffer(4);
    new Uint8Array(noExif).set([0xff, 0xd8, 0xff, 0xd9]);
    // 第一张无 GPS、第二张有 → 取第二张；顺序反过来 → 取第一张
    const second = await firstGps([
      new File([noExif], 'a.jpg', { type: 'image/jpeg' }),
      new File([withGps], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    expect(second?.lng).toBeCloseTo(116.4074, 4);
    const first = await firstGps([
      new File([withGps], 'a.jpg', { type: 'image/jpeg' }),
      new File([withGps], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    expect(first?.lat).toBeCloseTo(39.9042, 4);
    expect(await firstGps([])).toBeNull();
  });
});

describe('extractGpsCoords 纯函数', () => {
  it('缺 Latitude/Longitude → null；越界坐标 → null（脏数据静默丢弃）', () => {
    expect(extractGpsCoords({})).toBeNull();
    expect(extractGpsCoords({ gps: { Latitude: 91, Longitude: 0 } })).toBeNull();
    expect(extractGpsCoords({ gps: { Latitude: 0, Longitude: 181 } })).toBeNull();
    expect(extractGpsCoords({ gps: { Latitude: 39.9, Longitude: 116.4 } })).toEqual({ lat: 39.9, lng: 116.4 });
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/web test -- exif-gps.test.ts`
Expected: FAIL，`Cannot find module '@/compose/exif-gps'`（或等效模块解析错误）。

- [ ] **Step 4: 实现 exif-gps.ts**

Create `apps/web/src/compose/exif-gps.ts`：

```ts
import type { ExpandedTags } from 'exifreader';

/**
 * EXIF GPS 读取（spec people-place §3 web 端）：
 * - 只读文件头结构化元数据，不做像素解码；切片 256KB 对 JPEG 必然覆盖 APP1 段，
 *   对 HEIC 尽力而为（失败静默）。
 * - exifreader 动态 import（先例：ChainAppearanceEditor 的 EmojiPickerPanel 懒加载），
 *   compose 流程外零加载体积。
 * - 十进制换算与 S/W 取负用 exifreader expanded gps 组的预计算值（源码核实：
 *   gps.Latitude 由 DMS 有理数换算、Ref 为 S/W 时取负）；S/W 行为由 fixture 测试钉死。
 * - 任何失败（无 GPS / 形状异常 / 越界坐标 / 解析抛错）一律 null，绝不提示错误。
 */

/** WGS-84 十进制坐标（server 落库原值，spec §4）。 */
export interface GpsCoords {
  lat: number;
  lng: number;
}

/** EXIF 切片上限（spec §3）：256 * 1024。 */
const EXIF_SLICE_BYTES = 256 * 1024;

/** 从 exifreader expanded tags 提取十进制 GPS；无 GPS / 非有限数 / 越界 → null。 */
export function extractGpsCoords(tags: ExpandedTags): GpsCoords | null {
  const lat = tags.gps?.Latitude;
  const lng = tags.gps?.Longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // 客户端坐标是不可信输入（spec §3）：越界视为脏数据静默丢弃（server 还有一层 400）
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** 解析 ArrayBuffer；exifreader 动态 import，任何异常 → null（静默）。 */
export async function parseExifGps(buffer: ArrayBuffer): Promise<GpsCoords | null> {
  try {
    const { load } = await import('exifreader');
    return extractGpsCoords(load(buffer, { expanded: true }));
  } catch {
    return null;
  }
}

/** 对 image/* 的 File 切前 256KB 解析；非 image → null。 */
export async function readGpsFromFile(file: File): Promise<GpsCoords | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const buffer = await file.slice(0, EXIF_SLICE_BYTES).arrayBuffer();
    return await parseExifGps(buffer);
  } catch {
    return null;
  }
}

/** 多图取第一张含 GPS 的照片，其余忽略（spec §3：v1 不做多坐标合并）。 */
export async function firstGps(files: readonly File[]): Promise<GpsCoords | null> {
  for (const file of files) {
    const coords = await readGpsFromFile(file);
    if (coords) return coords;
  }
  return null;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/web test -- exif-gps.test.ts`
Expected: PASS，全部用例过（含 S/W 负号两条）。若 exifreader 动态 import 在 vitest 下解析失败（CJS interop 差异），停手报告编排主 Agent，不得自行改用静态 import。

- [ ] **Step 6: 门禁**

Run: `pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`
Expected: exit 0。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/compose/exif-gps.ts apps/web/src/compose/exif-gps.test.ts
git commit -m "feat(web): add EXIF GPS reader with sliced buffer and dynamic exifreader import"
```

---

### Task 3: ComposePanelService 人物/地点草稿 + dirty tracking + submit 集成

**Files:**
- Modify: `apps/web/src/compose/compose-panel/compose-panel.service.ts`
- Test: `apps/web/src/compose/compose-panel/compose-panel.service.test.ts`（新建）

**Interfaces:**
- Consumes（P1/P2 Produces + Task 1/2 Produces 逐字引用）:
  - `@moment/dto`：`PersonResponse`（`{id, name, userId}`）、`PersonBrief`（`{id, name, userId, source}`）、`ChainMemberDto`（`{userId, nickname, avatarUrl, role, joinedAt}`）、`MomentResponse`（persons/place 必填形态）
  - `client.listPersons / createPerson`（Task 1）、`client.listMembers`（既有）、`client.createMoment / updateMoment`（既有，Task 1 确认携带 personIds/place）
  - `firstGps`（Task 2，`@/compose/exif-gps`）
  - 既有 `timeEdited` 判脏先例（`compose-panel.service.ts` submit 内：`timeEdited = Boolean(edit) && this.happenedAt !== toWallClockInput(...)` → 条件 spread 进 patch body）
- Produces（Task 4 / P6 消费——**P6 抄这份的 dirty tracking 纪律与行为语义**）:
  - 状态：`personList: PersonResponse[]`、`members: ChainMemberDto[]`、`selectedPersons: PersonBrief[]`、`personQuery: string`、`personsTouched: boolean`、`placeName: string`、`placeCoords: { lat: number; lng: number } | null`、`placeTouched: boolean`、`exifDismissed: boolean`
  - `hydrate(request)`：编辑模式水合 `selectedPersons = [...edit.persons]`（含 ai 行及 source，供 AI 角标）、`placeName = edit.place?.name ?? ''`、`placeCoords` 从 `edit.place.lat/lng`（两者均非 null 才有）；三个 touched 标志与 `exifDismissed` 一律复位 false
  - `loadPersons(): Promise<void>`：`Promise.allSettled([client.listPersons(chainId), client.listMembers(chainId)])`——两路独立成败，各自失败静默清各自列表（词典与成员是两个接口，词典失败不牵连成员置顶）；await 后链已切换则丢弃（防串链，对齐 `loadManifest`）
  - `pickChain(chainId)`：切换时清空 personList/members/selectedPersons 并复位 `personsTouched`（词典是链级作用域，spec §0）；place 草稿**保留**（镜像 images 在切链时保留的既有行为）
  - `togglePerson(person: PersonBrief): void`：增删切换，置 `personsTouched = true`——**动作级判脏**（见计划偏差 3：删除后加回同一 ai person（id 集合与基线相同）也要提交，source 升级 manual 才会发生）
  - `asBrief(person: PersonResponse | PersonBrief): PersonBrief`（private）：`'source' in person` 原样返回（PersonBrief）；词典行（PersonResponse 无 source）补 `source: 'manual'`——词典命中是用户主动选择，选中态语义恒 manual。`toggleMember`/`submitPersonQuery` 的 `existing` 经此收口再传 `togglePerson`（PersonResponse 不可直赋 PersonBrief）
  - `toggleMember(member: ChainMemberDto): Promise<void>`：词典（含已选集）有 `userId` 命中 → 直接 `togglePerson`；否则幂等 `client.createPerson(chainId, { name: member.nickname, userId: member.userId })` 后入册并选中；POST 失败写 `error`（humanError）
  - `submitPersonQuery(): Promise<void>`：trim 后为空直接返回；词典（含已选集）同名命中 → `togglePerson` 短路（不 POST）；否则幂等 `client.createPerson(chainId, { name })` 后入册并选中；成功清空 `personQuery`
  - `setPlaceName(name: string): void`：置 `placeTouched = true` 并写 `placeName`
  - `removePlaceCoords(): void`：置 `placeTouched = true`、`exifDismissed = true`、`placeCoords = null`（spec §3「可点 × 移除」；移除后本会话不再自动回填）
  - `addImages(files)`：入口处 `void this.ingestExif(files).catch(() => undefined)`——选图/粘贴/拖拽三条路径都过 `addImages`（`onPickImages` / `addMediaFiles` 汇聚点），EXIF 只在草稿完全为空（`!placeCoords && placeName.trim() === '' && !exifDismissed`）时经 `firstGps` 写 `placeCoords`，**不置 placeTouched**（非用户动作，但 create 提交时照常携带）
  - `placePayload(): { name?: string; lat?: number; lng?: number } | null`（private）：名字（trim 后）与坐标皆空 → `null`；有坐标 → `{ ...(name ? {name} : {}), lat, lng }`；仅名字 → `{ name }`
  - `submit()`：前置守卫 `selectedPersons.length > 20` → `error = '最多关联 20 位人物'`；**update 分支** `...(this.personsTouched ? { personIds: this.selectedPersons.map(p => p.id) } : {})` + `...(this.placeTouched ? { place: this.placePayload() } : {})`（对齐 timeEdited 条件 spread 范式）；**create 分支** `...(this.selectedPersons.length > 0 ? { personIds } : {})` + `...(this.placeTouched || this.placeCoords ? { place: this.placePayload() } : {})`

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/compose/compose-panel/compose-panel.service.test.ts`：

```ts
import { register, resolve } from '@rabjs/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto, MomentResponse } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { ComposePanelService } from './compose-panel.service';

// ComposePanelService 的人物/地点草稿与 dirty tracking 契约（spec people-place §6）：
// - undefined = 不变：未动人物/地点时 updateMoment 请求体不含 personIds/place 键
//   （整包回传会把 ai 行静默升级 manual、exif place 误升级 manual——spec §6 警告）；
// - 动作级判脏：任一增删动作即提交当前全集；删除后加回同一 ai person
//   （id 集合与基线相同）也提交（spec §5 升级路径）；
// - place：改过才提交；显式清空（名字清空 + 移除坐标）→ place:null（spec §6 清除语义）；
// - EXIF：仅地点草稿完全为空时自动回填（多图第一张含 GPS），提交 {lat,lng} 无 name
//   （spec §3：落 exif 分支，name 由 geocode 异步回填）。

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  createPerson: vi.fn(),
  createMoment: vi.fn(),
  updateMoment: vi.fn(),
}));

const exif = vi.hoisted(() => ({ firstGps: vi.fn() }));

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
vi.mock('@/compose/exif-gps', () => ({ firstGps: exif.firstGps }));

register(AuthService);
register(ChainListService);
register(ComposeSessionService);
register(ComposePanelService);

function chain(id: string): ChainDto {
  return {
    id,
    name: `链${id}`,
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: null,
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    myRole: 'owner',
  };
}

function editMoment(partial: Partial<MomentResponse> = {}): MomentResponse {
  return {
    id: 'm-1',
    chainId: 'chain-1',
    author: { id: 'u-1', nickname: '妈妈', avatarUrl: null },
    type: 'text',
    content: '在外婆家吃饭',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [],
    tags: [],
    persons: [],
    place: null,
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...partial,
  };
}

function svc(): ComposePanelService {
  return resolve(ComposePanelService);
}

beforeAll(() => {
  // jsdom 无 object URL 实现（chain-home.test.tsx / create-chain-dialog 同一约定）
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((f: File) => `blob:${f.name}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listTags.mockResolvedValue({ tags: [] });
  api.listPersons.mockResolvedValue({ persons: [] });
  api.listMembers.mockResolvedValue([]);
  api.createMoment.mockResolvedValue(editMoment());
  api.updateMoment.mockResolvedValue(editMoment());
  resolve(ChainListService).chains = [chain('chain-1')];
  const s = svc();
  // 单例跨用例复位（不走 hydrate，绕开 request 依赖）
  s.request = null;
  s.pickedChainId = 'chain-1';
  s.content = '';
  s.images = [];
  s.video = null;
  s.voice = null;
  s.selectedTags = [];
  s.personList = [];
  s.members = [];
  s.selectedPersons = [];
  s.personQuery = '';
  s.personsTouched = false;
  s.placeName = '';
  s.placeCoords = null;
  s.placeTouched = false;
  s.exifDismissed = false;
  s.error = null;
});

describe('编辑模式 dirty tracking（spec §6：undefined = 不变）', () => {
  it('未动人物/地点 → updateMoment 请求体不含 personIds/place 键（ai 行不被升级、exif place 不被误升级）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({
        persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }],
        place: { lat: 39.9, lng: 116.4, name: '北京市东城区', source: 'exif' },
      }),
    });
    s.content = '只改正文';
    await s.submit();
    expect(api.updateMoment).toHaveBeenCalledTimes(1);
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('personIds');
    expect(body).not.toHaveProperty('place');
    expect(body.content).toBe('只改正文');
  });

  it('增删过人物（动作级判脏）→ personIds 提交当前全集（含未单独触碰的行，server 写 manual）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }] }),
    });
    s.togglePerson({ id: 'p-2', name: '朵朵', userId: null, source: 'manual' });
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.personIds).toEqual(['p-1', 'p-2']);
  });

  it('删除后加回同一 ai person（id 集合与基线相同）仍提交（spec §5 升级路径）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ persons: [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }] }),
    });
    s.togglePerson({ id: 'p-1', name: '外婆', userId: null, source: 'ai' }); // 删
    s.togglePerson({ id: 'p-1', name: '外婆', userId: null, source: 'manual' }); // 加回
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.personIds).toEqual(['p-1']);
  });

  it('地点手动输入 → place {name}（无坐标）', async () => {
    const s = svc();
    s.hydrate({ edit: editMoment() });
    s.setPlaceName('外婆家');
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ name: '外婆家' });
  });

  it('显式清空（名字清空 + 移除坐标）→ place:null（spec §6 清除语义）', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ place: { lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' } }),
    });
    s.setPlaceName('');
    s.removePlaceCoords();
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toBeNull();
  });

  it('编辑回读带坐标（placeTouched=false）→ 不提交 place', async () => {
    const s = svc();
    s.hydrate({
      edit: editMoment({ place: { lat: 39.9, lng: 116.4, name: null, source: 'exif' } }),
    });
    await s.submit();
    const body = api.updateMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('place');
  });
});

describe('新建模式：EXIF 自动回填与提交形态（spec §3）', () => {
  it('加图触发 firstGps：草稿为空 → 写 coords（不置 placeTouched）；提交 place = {lat,lng} 无 name（exif 分支）', async () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).toEqual({ lat: 39.9042, lng: 116.4074 }));
    expect(s.placeTouched).toBe(false);
    s.images = []; // 隔离 place 断言：跳过媒体上传路径
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('草稿已有地点名 → EXIF 不覆盖（manual > exif，偏差 2）', () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.placeName = '外婆家';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    // ingestExif 第一行守卫同步短路（先于 firstGps），不做 waitFor——直接断言结果态：
    // firstGps 从未被调用，地点名保持原值、坐标仍为空
    expect(exif.firstGps).not.toHaveBeenCalled();
    expect(s.placeCoords).toBeNull();
    expect(s.placeName).toBe('外婆家');
  });

  it('移除 chip（exifDismissed）后再加图不自动回填（偏差 2：「删不掉」防御）', async () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).toEqual({ lat: 39.9042, lng: 116.4074 }));
    s.removePlaceCoords();
    expect(s.placeCoords).toBeNull();
    s.addImages([new File(['y'], 'b.jpg', { type: 'image/jpeg' })]);
    // 第二次 addImages 的 ingestExif 守卫同步短路：exifDismissed 置位后不再调 firstGps，坐标不复活
    expect(exif.firstGps).toHaveBeenCalledTimes(1);
    expect(s.placeCoords).toBeNull();
  });

  it('手动名字 + EXIF 坐标 → place = {name, lat, lng}（赋值表「坐标+名字 → manual」）', async () => {
    exif.firstGps.mockResolvedValue({ lat: 39.9042, lng: 116.4074 });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.addImages([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]);
    await vi.waitFor(() => expect(s.placeCoords).not.toBeNull());
    s.setPlaceName('外婆家');
    s.images = [];
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.place).toEqual({ name: '外婆家', lat: 39.9042, lng: 116.4074 });
  });

  it('选中人物（回车新建路径）→ createMoment 带 personIds', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-9', name: '王叔叔', userId: null });
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.personQuery = '王叔叔';
    await s.submitPersonQuery();
    expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '王叔叔' });
    await s.submit();
    const body = api.createMoment.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.personIds).toEqual(['p-9']);
  });

  it('人物超过 20 位 → 前置错误，不发请求（dto max 20）', async () => {
    const s = svc();
    s.hydrate({ chainId: 'chain-1' });
    s.content = '此刻';
    s.selectedPersons = Array.from({ length: 21 }, (_, i) => ({
      id: `p-${i}`,
      name: `人${i}`,
      userId: null,
      source: 'manual' as const,
    }));
    s.personsTouched = true;
    await s.submit();
    expect(s.error).toBe('最多关联 20 位人物');
    expect(api.createMoment).not.toHaveBeenCalled();
  });
});

describe('人物词典与链成员（spec §6/§7）', () => {
  it('submitPersonQuery：词典同名命中 → 直接选，不 POST（幂等短路）', async () => {
    const s = svc();
    s.personList = [{ id: 'p-1', name: '外婆', userId: null }];
    s.personQuery = '外婆';
    await s.submitPersonQuery();
    expect(api.createPerson).not.toHaveBeenCalled();
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']);
    expect(s.personsTouched).toBe(true);
  });

  it('toggleMember：词典已有该用户的 person → 直接选，不 POST', async () => {
    const s = svc();
    s.personList = [{ id: 'p-1', name: '林晓满', userId: 'u-1' }];
    await s.toggleMember({ userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    expect(api.createPerson).not.toHaveBeenCalled();
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']);
  });

  it('toggleMember：词典无 → 幂等 POST {name, userId} 并入册选中（spec §7 链接语义）', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-2', name: '林晓满', userId: 'u-1' });
    const s = svc();
    await s.toggleMember({ userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '林晓满', userId: 'u-1' });
    expect(s.personList.map((p) => p.id)).toEqual(['p-2']);
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-2']);
  });

  it('pickChain：切链清空人物选择与词典（人物是链级作用域，spec §0）', () => {
    const s = svc();
    s.selectedPersons = [{ id: 'p-1', name: '外婆', userId: null, source: 'manual' }];
    s.personsTouched = true;
    s.personList = [{ id: 'p-1', name: '外婆', userId: null }];
    s.members = [{ userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' }];
    s.pickChain('chain-2'); // beforeEach 已置 pickedChainId = 'chain-1'，切换生效
    expect(s.selectedPersons).toEqual([]);
    expect(s.personsTouched).toBe(false);
    expect(s.personList).toEqual([]);
    expect(s.members).toEqual([]);
  });

  it('loadPersons：并行拉词典与成员；词典失败静默只清词典，成员独立成功不受牵连', async () => {
    api.listPersons.mockRejectedValue(new Error('network'));
    api.listMembers.mockResolvedValue([
      { userId: 'u-1', nickname: '林晓满', avatarUrl: null, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const s = svc();
    await s.loadPersons();
    expect(s.personList).toEqual([]);
    expect(s.members.map((m) => m.nickname)).toEqual(['林晓满']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- compose-panel.service.test.ts`
Expected: FAIL——TS 编译错误（`personList` / `personsTouched` / `setPlaceName` 等属性方法不存在）或运行时 `undefined` 断言失败。红后进 Step 3。

- [ ] **Step 3: 实现 compose-panel.service.ts 增量**

Modify `apps/web/src/compose/compose-panel/compose-panel.service.ts`：

(a) import 区——`import type { MomentResponse, TagResponse, TemplateManifest } from '@moment/dto';` 替换为：

```ts
import type { ChainMemberDto, MomentResponse, PersonBrief, PersonResponse, TagResponse, TemplateManifest } from '@moment/dto';
```

`import { compressImage } from '@/lib/compress';` 之后追加一行：

```ts
import { firstGps } from '@/compose/exif-gps';
```

(b) 状态字段——`geoBusy = false;` 之后、`private manifestChainId = '';` 之前追加：

```ts
  // ---- 人物与地点（spec people-place §3/§6/§7）----
  /** 链 person 词典（选择器数据源，spec §6 GET persons） */
  personList: PersonResponse[] = [];
  /** 链成员（置顶 chip 数据源；选中 = 以该用户建/复用 person，spec §7） */
  members: ChainMemberDto[] = [];
  /** 选中人物全集（展示态含 source 供 AI 角标；提交时只取 id，source 永不上送） */
  selectedPersons: PersonBrief[] = [];
  personQuery = '';
  /** dirty tracking（spec §6）：仅用户实际增删过人物才提交 personIds（动作级判脏，见计划偏差 3） */
  personsTouched = false;
  /** 地点草稿：name 手动输入；coords 来自 EXIF（或编辑回读）。两者独立可组合 */
  placeName = '';
  placeCoords: { lat: number; lng: number } | null = null;
  /** dirty tracking（spec §6）：仅用户实际改过地点才提交 place；place:null = 显式清除 */
  placeTouched = false;
  /** 用户点 × 移除 EXIF chip 后本面板会话不再自动回填（否则删不掉，见计划偏差 2） */
  exifDismissed = false;
```

(c) `hydrate()` —— `this.payloadDraft = { ...(request.edit?.payload ?? {}) };` 之后追加：

```ts
    // 人物/地点水合（spec §6）：编辑模式展示全集（含 ai 行，source 仅供角标）；
    // 三个 touched 标志复位——未动过就不提交（undefined = 不变）
    this.selectedPersons = request.edit ? [...request.edit.persons] : [];
    this.personsTouched = false;
    this.placeName = request.edit?.place?.name ?? '';
    this.placeCoords =
      request.edit?.place?.lat != null && request.edit?.place?.lng != null
        ? { lat: request.edit.place.lat, lng: request.edit.place.lng }
        : null;
    this.placeTouched = false;
    this.exifDismissed = false;
    this.personList = [];
    this.members = [];
    this.personQuery = '';
```

(d) `loadTagList()` 之后追加：

```ts
  /** 拉链 person 词典 + 成员（选择器数据源）。失败静默：辅助输入不阻塞发布主流程（对齐 loadManifest 先例）。
   *  两路独立成败（allSettled）：词典与成员来自两个接口，词典失败只清词典，不牵连成员置顶。 */
  async loadPersons(): Promise<void> {
    const chainId = this.chainId;
    if (!chainId) {
      this.personList = [];
      this.members = [];
      return;
    }
    const [res, members] = await Promise.allSettled([
      client.listPersons(chainId),
      client.listMembers(chainId),
    ]);
    if (this.chainId !== chainId) return; // 异步返回时链已切换则丢弃（防串链）
    this.personList = res.status === 'fulfilled' ? res.value.persons : [];
    this.members = members.status === 'fulfilled' ? members.value : [];
  }
```

(e) `pickChain()` —— `this.manifestChainId = '';` 之后追加：

```ts
    // 人物词典是链级作用域（spec §0）：切链丢弃旧链选择
    this.personList = [];
    this.members = [];
    this.selectedPersons = [];
    this.personsTouched = false;
```

(f) `toggleTag(id)` 之后追加：

```ts
  /** 词典行 → PersonBrief（词典行无 source；选中是用户主动选择，语义恒 manual，spec §6 提交即 manual 意图）。 */
  private asBrief(person: PersonResponse | PersonBrief): PersonBrief {
    return 'source' in person ? person : { ...person, source: 'manual' as const };
  }

  /** 人物增删切换；置 personsTouched（动作级判脏：删除后加回同一 ai person 也要提交，spec §5 升级路径）。 */
  togglePerson(person: PersonBrief): void {
    this.personsTouched = true;
    this.selectedPersons = this.selectedPersons.some((p) => p.id === person.id)
      ? this.selectedPersons.filter((p) => p.id !== person.id)
      : [...this.selectedPersons, person];
  }

  /** 选中链成员 = 以该用户建/复用 person（spec §7）：词典/已选集有 userId 命中直接选，否则幂等 POST。 */
  async toggleMember(member: ChainMemberDto): Promise<void> {
    const existing =
      this.personList.find((p) => p.userId === member.userId) ??
      this.selectedPersons.find((p) => p.userId === member.userId);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      return;
    }
    try {
      const person = await client.createPerson(this.chainId, { name: member.nickname, userId: member.userId });
      if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
      this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
    } catch (e) {
      this.error = humanError(e);
    }
  }

  /** 词典搜索命中同名直接选；否则自由文本回车新建（幂等 POST，归一化撞名返回已存在行，spec §6/§7）。 */
  async submitPersonQuery(): Promise<void> {
    const name = this.personQuery.trim();
    if (!name || !this.chainId) return;
    const existing =
      this.personList.find((p) => p.name === name) ?? this.selectedPersons.find((p) => p.name === name);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      this.personQuery = '';
      return;
    }
    try {
      const person = await client.createPerson(this.chainId, { name });
      if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
      this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
      this.personQuery = '';
    } catch (e) {
      this.error = humanError(e);
    }
  }

  setPlaceName(name: string): void {
    this.placeTouched = true;
    this.placeName = name;
  }

  /** 移除 EXIF chip（spec §3「可点 × 移除」）：丢弃坐标且本会话不再自动回填。 */
  removePlaceCoords(): void {
    this.placeTouched = true;
    this.exifDismissed = true;
    this.placeCoords = null;
  }
```

(g) `addImages(files: File[])` —— 方法体第一行 `this.error = null;` 之后追加：

```ts
    void this.ingestExif(files).catch(() => undefined);
```

(h) `submit()` 之前追加两个 private 方法：

```ts
  /**
   * EXIF 自动回填（spec §3）：多图取第一张含 GPS 的；仅地点草稿完全为空时写入
   * （已手动输入或已移除 chip 不覆盖，偏差 2）。非用户动作，不置 placeTouched。
   */
  private async ingestExif(files: File[]): Promise<void> {
    if (this.exifDismissed || this.placeCoords || this.placeName.trim() !== '') return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    const coords = await firstGps(images);
    if (coords && !this.exifDismissed && !this.placeCoords && this.placeName.trim() === '') {
      this.placeCoords = coords;
    }
  }

  /**
   * place 提交形态（spec §6 赋值表在 server 判 source，客户端只交 name/坐标）：
   * 名字（trim 后）与坐标皆空 → null（显式清除）；有坐标 ±名字 → 整体提交
   * （坐标+名字 → manual「确认后的形态」；仅坐标 → exif）；仅名字 → {name}（manual 文本）。
   */
  private placePayload(): { name?: string; lat?: number; lng?: number } | null {
    const name = this.placeName.trim();
    if (name === '' && !this.placeCoords) return null;
    return this.placeCoords
      ? { ...(name !== '' ? { name } : {}), lat: this.placeCoords.lat, lng: this.placeCoords.lng }
      : { name };
  }
```

(i) `submit()` —— `if (!chainId) { ... }` 守卫之后、`const hasImages = this.images.length > 0;` 之前追加人物上限守卫（唯一锚点，与现状代码顺序一致）：

```ts
    if (this.selectedPersons.length > 20) {
      this.error = '最多关联 20 位人物';
      return;
    }
```

(j) update 分支——`await client.updateMoment(edit.id, { ... })` 的对象字面量内，`payload: ...` 行之后追加两行：

```ts
          // dirty tracking（spec §6）：undefined = 不变——未动过的人物/地点绝不整包回传
          ...(this.personsTouched ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
          ...(this.placeTouched ? { place: this.placePayload() } : {}),
```

(k) create 分支——`await client.createMoment(chainId, { ... })` 的对象字面量内，`tagIds: this.selectedTags,` 之后追加两行：

```ts
          ...(this.selectedPersons.length > 0 ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
          // EXIF 路（spec §3）：未动过但有坐标 → {lat,lng}（exif 分支）；动过按 placePayload（含 null 清除）
          ...(this.placeTouched || this.placeCoords ? { place: this.placePayload() } : {}),
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- compose-panel.service.test.ts`
Expected: PASS，全部用例过。

- [ ] **Step 5: 全量回归 + 门禁**

Run: `pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`
Expected: 全绿（既有 chain-home.test.tsx 等不受影响——ComposePanel 渲染路径的新 effect 由其 api Proxy 桩兜底，未列方法永不 settle）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/compose/compose-panel/compose-panel.service.ts apps/web/src/compose/compose-panel/compose-panel.service.test.ts
git commit -m "feat(web): add persons and place draft state with dirty tracking to compose service"
```

---

### Task 4: 人物选择器 + 地点输入组件（面板接线 + humanError 词条）

**Files:**
- Create: `apps/web/src/compose/compose-panel/person-picker.tsx`
- Test: `apps/web/src/compose/compose-panel/person-picker.test.tsx`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`（import + loadPersons effect + isDirty + 渲染）
- Modify: `apps/web/src/lib/errors.ts`（PERSON_* 错误词条）

**Interfaces:**
- Consumes:
  - Task 3 Produces 的全部 service 状态与方法（`personList` / `members` / `selectedPersons` / `personQuery` / `placeName` / `placeCoords` / `togglePerson` / `toggleMember` / `submitPersonQuery` / `setPlaceName` / `removePlaceCoords` / `personQuery` 可写）
  - 既有 UI 组件：`Input` / `TextField`（`@/ui/field`，Field/Input 规范 §2.1/§2.2/§8——label 可见、B 方案柔和色面、44px 控件）、`IconButton`（`@/ui/button`，Button 规范 IconButton——40/44px 点击区 + 独立 aria-label）、`Tooltip`（`@/ui/tooltip`，Menu/Popover/Tooltip 规范 §9——短纯文本、fine pointer 600ms、coarse 不渲染）
  - 既有 chip 形状常量（`apps/web/src/compose/template-fields.tsx` 的 `CHIP_BASE/CHIP_ON/CHIP_OFF`——rounded-full + text-caption + border-line / bg-select 选中态，类名逐字一致复用，不新增 token）
  - `lucide-react` 的 `MapPin` / `X`（web-ui 规则：图标使用 Lucide）
- Produces（P6 消费——**app 端镜像本 UX 语义**）:
  - `PersonPicker = observer(({ service }: { service: ComposePanelService }) => JSX.Element)`（props-driven observer，镜像 `TemplateFields` 范式；非 bindServices——实例来自 ComposeBody 的容器）
  - 行为契约：**链成员置顶 chip 组**（`aria-pressed` 选中态，点击 = `toggleMember`）；**词典 chip 组**（前端 `includes` 过滤 + 已由成员 chip 代表的 userId 链接行去重，`aria-pressed` 多选，选中的 ai 来源行 chip 内带 `text-muted` 的「AI」角标 + `Tooltip`「AI 从这条时刻的文字里认出来的人物」悬停提示；**已选但未入词典的行纯前端并入 chip 组置顶**——编辑模式词典未加载时已选人物（含 ai 行）仍可见可删）；**搜索/新建输入**（`Input`，aria-label「搜索或新建人物」，Enter 提交 = `submitPersonQuery`）；**地点 `TextField`**（label「在哪里」、isOptional、placeholder「比如：外婆家」）；**EXIF chip**（`MapPin` 图标 + 文案「已从照片读取位置」+ `IconButton X`「移除照片位置」→ `removePlaceCoords`）
  - 面板接线：`index.tsx` 挂 `loadPersons` effect（`[service, service.chainId]`，镜像 loadTagList）；`isDirty()` 增加 `service.personsTouched || service.placeTouched` 判脏（草稿丢弃确认覆盖人物/地点草稿）；`{chainId && <PersonPicker service={service} />}` 渲染在标签 chip 区之后
  - `humanError` 新词条：`PERSON_NOT_IN_CHAIN` / `PERSON_NAME_CONFLICT` / `PERSON_NOT_FOUND` / `PERSON_USER_NOT_IN_CHAIN`

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/compose/compose-panel/person-picker.test.tsx`：

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { register, resolve } from '@rabjs/react';
import type { ChainDto, ChainMemberDto } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { ComposePanelService } from './compose-panel.service';
import { PersonPicker } from './person-picker';

// 人物选择器 + 地点输入契约（spec people-place §7）：
// - 链成员置顶 chip：选中即幂等 POST {name, userId}（词典已有该用户则直接选，不 POST）；
// - 词典 chip 多选（aria-pressed），选中的 ai 来源行带「AI」角标；
// - 自由文本回车 → 幂等 POST {name} 并选中；
// - 地点 TextField + EXIF chip（「已从照片读取位置」，点 × 移除）。
// jsdom 下 RAB 属性变更不触发 observer 重渲（chain-home.test.tsx 同一约定）：
// 初始 DOM 断言靠渲染前播种，交互断言以 service 状态 + api 调用参数为准。

const api = vi.hoisted(() => ({
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  createPerson: vi.fn(),
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
register(ChainListService);
register(ComposeSessionService);
register(ComposePanelService);

function chain(id: string): ChainDto {
  return {
    id,
    name: `链${id}`,
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: null,
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    myRole: 'owner',
  };
}

const MEMBER: ChainMemberDto = {
  userId: 'u-1',
  nickname: '林晓满',
  avatarUrl: null,
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
};

/** 单例复位 + 播种（不走 hydrate，直接写字段）。 */
function seed(): ComposePanelService {
  const s = resolve(ComposePanelService);
  s.request = null;
  s.pickedChainId = 'chain-1';
  s.personList = [];
  s.members = [];
  s.selectedPersons = [];
  s.personQuery = '';
  s.personsTouched = false;
  s.placeName = '';
  s.placeCoords = null;
  s.placeTouched = false;
  s.exifDismissed = false;
  s.error = null;
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolve(ChainListService).chains = [chain('chain-1')];
});

describe('PersonPicker（spec people-place §7）', () => {
  it('链成员置顶 + 词典 chip 多选（aria-pressed）+ AI 角标 + 地点输入框', () => {
    const s = seed();
    s.members = [MEMBER];
    s.personList = [{ id: 'p-1', name: '外婆', userId: null }];
    s.selectedPersons = [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }];
    render(<PersonPicker service={s} />);
    expect(screen.getByText('林晓满')).toBeInTheDocument(); // 链成员置顶
    const chip = screen.getByRole('button', { name: /外婆/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AI')).toBeInTheDocument(); // ai 来源角标（spec §7 轻标识）
    expect(screen.getByLabelText('在哪里')).toBeInTheDocument();
  });

  it('已选但词典未加载的行（如编辑模式 ai 人物）并入 chip 组：可见、带 AI 角标、可删（置顶）', () => {
    const s = seed();
    s.selectedPersons = [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }];
    render(<PersonPicker service={s} />);
    const chip = screen.getByRole('button', { name: /外婆/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AI')).toBeInTheDocument();
    fireEvent.click(chip);
    expect(s.selectedPersons).toEqual([]);
  });

  it('点链成员：词典无该用户 → 幂等 POST {name, userId} 并选中', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-2', name: '林晓满', userId: 'u-1' });
    const s = seed();
    s.members = [MEMBER];
    render(<PersonPicker service={s} />);
    fireEvent.click(screen.getByText('林晓满'));
    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '林晓满', userId: 'u-1' }));
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-2']);
    expect(s.personsTouched).toBe(true);
  });

  it('点链成员：词典已有该用户的 person → 直接选，不 POST', async () => {
    const s = seed();
    s.members = [MEMBER];
    s.personList = [{ id: 'p-1', name: '林晓满', userId: 'u-1' }];
    render(<PersonPicker service={s} />);
    fireEvent.click(screen.getByText('林晓满'));
    await waitFor(() => expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']));
    expect(api.createPerson).not.toHaveBeenCalled();
  });

  it('自由文本回车 → 幂等 POST {name} 并选中、清空输入（spec §6/§7）', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-9', name: '王叔叔', userId: null });
    const s = seed();
    render(<PersonPicker service={s} />);
    const input = screen.getByLabelText('搜索或新建人物');
    fireEvent.change(input, { target: { value: '王叔叔' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '王叔叔' }));
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-9']);
    expect(s.personQuery).toBe('');
  });

  it('词典输入即前端过滤（偏差 6：全量 GET + includes）', () => {
    const s = seed();
    s.personList = [
      { id: 'p-1', name: '外婆', userId: null },
      { id: 'p-2', name: '朵朵', userId: null },
    ];
    s.personQuery = '朵';
    render(<PersonPicker service={s} />);
    expect(screen.queryByText('外婆')).toBeNull();
    expect(screen.getByRole('button', { name: /朵朵/ })).toBeInTheDocument();
  });

  it('EXIF chip：「已从照片读取位置」+ 点 × 移除（placeTouched/exifDismissed 置位）', () => {
    const s = seed();
    s.placeCoords = { lat: 39.9042, lng: 116.4074 };
    render(<PersonPicker service={s} />);
    expect(screen.getByText('已从照片读取位置')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('移除照片位置'));
    expect(s.placeCoords).toBeNull();
    expect(s.placeTouched).toBe(true);
    expect(s.exifDismissed).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- person-picker.test.tsx`
Expected: FAIL，`Cannot find module './person-picker'`（或等效）。

- [ ] **Step 3: 实现 person-picker.tsx**

Create `apps/web/src/compose/compose-panel/person-picker.tsx`：

```tsx
import { observer } from '@rabjs/react';
import type { ChainMemberDto, PersonResponse } from '@moment/dto';
import { MapPin, X } from 'lucide-react';
import { IconButton } from '@/ui/button/index';
import { Input, TextField } from '@/ui/field/index';
import { Tooltip } from '@/ui/tooltip/index';
import type { ComposePanelService } from './compose-panel.service';

// 人物选择器 + 地点输入（spec people-place §7）：chip 多选、链成员置顶（选中 = 以该
// 用户建/复用 person）、词典搜索（前端过滤）、自由文本回车新建（幂等 POST）。
// AI 抽取行带「AI」角标（轻标识），悬停提示走 ui/tooltip（Menu/Popover/Tooltip 规范 §9）。
//
// 视觉全部复用既有模式，不新增 token：chip 与 TemplateFields 词表 chip 同一形状
// （template-fields.tsx 既有 CHIP_BASE/CHIP_ON/CHIP_OFF，类名逐字一致）；地点文本框走
// Field 家族 TextField（Field/Input 规范 §2.2/§8，label 可见 + isOptional）；
// EXIF chip 移除走 IconButton（Button 规范）。
// props-driven observer（镜像 template-fields.tsx 的 service prop 范式）。

const CHIP_BASE =
  'rounded-full border px-3 py-1 text-caption transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus';
const CHIP_ON = 'border-transparent bg-select text-select-fg';
const CHIP_OFF = 'border-line text-ink hover:bg-floating-hover';

export const PersonPicker = observer(function PersonPicker({ service }: { service: ComposePanelService }) {
  const query = service.personQuery.trim().toLowerCase();
  // 词典搜索（偏差 6）：前端 includes 过滤；已由链成员 chip 代表的 user_id 链接行不重复出现（偏差 7）
  const linkedUserIds = new Set(service.members.map((m) => m.userId));
  const dictionary = service.personList.filter(
    (p) => (!p.userId || !linkedUserIds.has(p.userId)) && p.name.toLowerCase().includes(query),
  );
  // 已选但不在词典的行（编辑模式词典未加载时的 ai 人物等）仍可见可删：
  // 纯前端并入词典 chip 组并置顶渲染（PersonBrief 结构上含 PersonResponse 全字段，直用）
  const dictionaryIds = new Set(service.personList.map((p) => p.id));
  const selectedOnly = service.selectedPersons.filter(
    (p) =>
      !dictionaryIds.has(p.id) &&
      (!p.userId || !linkedUserIds.has(p.userId)) &&
      p.name.toLowerCase().includes(query),
  );
  const selectedIds = new Set(service.selectedPersons.map((p) => p.id));
  const memberSelected = (m: ChainMemberDto) => service.selectedPersons.some((p) => p.userId === m.userId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-meta text-muted">和谁在一起</p>
        <div className="flex flex-wrap items-center gap-2" aria-label="人物">
          {/* 链成员置顶（spec §7）：选中即建/复用 user_id 链接的 person */}
          {service.members.map((m) => (
            <button
              key={m.userId}
              type="button"
              aria-pressed={memberSelected(m)}
              onClick={() => void service.toggleMember(m)}
              className={`${CHIP_BASE} ${memberSelected(m) ? CHIP_ON : CHIP_OFF}`}
            >
              {m.nickname}
            </button>
          ))}
          {selectedOnly.map((p) => (
            <DictionaryChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
          ))}
          {dictionary.map((p) => (
            <DictionaryChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void service.submitPersonQuery();
            }}
          >
            <Input
              aria-label="搜索或新建人物"
              value={service.personQuery}
              onChange={(e) => (service.personQuery = e.target.value)}
              placeholder="搜索或回车新建"
              className="w-40"
            />
          </form>
        </div>
      </div>

      <TextField
        label="在哪里"
        name="place"
        isOptional
        value={service.placeName}
        onChange={(v) => service.setPlaceName(v)}
        placeholder="比如：外婆家"
      />
      {service.placeCoords && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-caption text-ink">
            <MapPin aria-hidden="true" size={16} />
            已从照片读取位置
          </span>
          <IconButton icon={X} label="移除照片位置" variant="secondary" onClick={() => service.removePlaceCoords()} />
        </div>
      )}
    </div>
  );
});

/** 词典 chip：选中的 ai 来源行带「AI」角标（spec §7 轻标识），Tooltip 悬停提示来源。 */
const DictionaryChip = observer(function DictionaryChip({
  service,
  person,
  selected,
}: {
  service: ComposePanelService;
  person: PersonResponse;
  selected: boolean;
}) {
  const source = service.selectedPersons.find((p) => p.id === person.id)?.source;
  const chip = (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() =>
        service.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: source ?? 'manual' })
      }
      className={`${CHIP_BASE} ${selected ? CHIP_ON : CHIP_OFF}`}
    >
      {person.name}
      {selected && source === 'ai' && <span className="ml-1 text-muted">AI</span>}
    </button>
  );
  return selected && source === 'ai' ? (
    <Tooltip label="AI 从这条时刻的文字里认出来的人物">{chip}</Tooltip>
  ) : (
    chip
  );
});
```

- [ ] **Step 4: 面板接线（index.tsx）**

Modify `apps/web/src/compose/compose-panel/index.tsx`：

(a) import 区 `import { VideoPosterPicker } from './video-poster';` 之后追加：

```tsx
import { PersonPicker } from './person-picker';
```

(b) 既有 `useEffect(() => { void service.loadTagList(); }, [service, service.chainId]);` 之后追加：

```tsx
  useEffect(() => {
    void service.loadPersons(); // 失败静默（service 注释），选择器保持空列表不阻塞发布
  }, [service, service.chainId]);
```

(c) `isDirty()` 内 `if (service.selectedTags.some((id) => !base.tagIds.includes(id))) return true;` 之后追加：

```tsx
    // 人物/地点草稿（spec people-place §6）：用户动作级判脏（未动 = 不算草稿变化）
    if (service.personsTouched || service.placeTouched) return true;
```

（EXIF 自动回填不置 touched；其伴随的图片本身已使 `service.images.length > 0` 判 dirty。）

(d) 渲染——标签 chip 区 `{chainId && ( <div className="flex flex-wrap items-center gap-2"> … </div> )}` 的闭合 `)}` 之后、`{service.error && <Banner …>}` 之前追加：

```tsx
          {chainId && <PersonPicker service={service} />}
```

- [ ] **Step 5: humanError 词条**

Modify `apps/web/src/lib/errors.ts` — `COPY` 映射内 `TAG_NOT_IN_CHAIN: '这个标签不属于这条链',` 之后追加：

```ts
  PERSON_NOT_IN_CHAIN: '这个人物不属于这条链',
  PERSON_NAME_CONFLICT: '已经有同名的人物了',
  PERSON_NOT_FOUND: '这个人已经不在了',
  PERSON_USER_NOT_IN_CHAIN: '这位家人不在链里',
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm --filter @moment/web test -- person-picker.test.tsx`
Expected: PASS，全部用例过。

- [ ] **Step 7: 全量回归 + 门禁**

Run: `pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint`
Expected: 全绿（chain-home.test.tsx 渲染 ComposePanel：新 `loadPersons` effect 走其 api Proxy 桩未列方法永不 settle，无回归）。

- [ ] **Step 8: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/compose/compose-panel/person-picker.tsx apps/web/src/compose/compose-panel/person-picker.test.tsx \
  apps/web/src/compose/compose-panel/index.tsx apps/web/src/lib/errors.ts
git commit -m "feat(web): add person picker and place field with EXIF chip to compose panel"
```

---

### Task 5: 时刻卡片/详情的人物 chip 行与地点行（只读展示）

**Files:**
- Modify: `apps/web/src/timeline/moment-sheet.tsx`（`MomentSheetMoment` 类型 + persons chip 行 + place 行）
- Test: `apps/web/src/timeline/moment-sheet-people-place.test.tsx`（新建）

**Interfaces:**
- Consumes（P1/P2 Produces 逐字引用）:
  - `@moment/dto`：`PublicShareMoment`（P2：`Omit<MomentResponse, 'persons' | 'place'>`——公开分享路径类型，两键不存在）、`PersonBrief`（`{id, name, userId, source}`）、`MomentPlace`（`{lat, lng, name, source}`）、`MomentResponse`
  - P2 已把 `MomentSheetContent` 的 `moment` prop 放宽为 `PublicShareMoment`（Timeline 组件链分享页/链内页共用）
  - 既有 moment-sheet 范式：tags 的正文内文本流展示（`inlineTags`）、payload.geo 行（`📍 {name}` 的 `text-meta text-muted` 行）、chip 形状常量（Task 4 同款）
- Produces（P6 消费）:
  - `export type MomentSheetMoment = PublicShareMoment & { persons?: PersonBrief[]; place?: MomentPlace | null }`（moment-sheet.tsx 导出的类型别名；公开路径两键可选——红线在类型层生效，链内传 `MomentResponse` 超集）
  - 展示行为契约（P6 镜像）：`moment.persons?.length > 0` → 人物 chip 行（`aria-label="和谁在一起"`，**span 非按钮**——只读不可点，点击过滤属 M2，spec §7）；ai 来源行 chip 内带「AI」`text-muted` 角标；`moment.place?.name` 非空 → 地点行（`📍 {name}`，镜像既有 geo payload 行；name 为 null 的 exif 待回填坐标**不显示**，偏差 9）；persons/place 键不存在（公开分享）→ 两行均不渲染
  - `openCompose` 处 `edit: moment as MomentResponse`（cast 理由见计划偏差 8）

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/timeline/moment-sheet-people-place.test.tsx`：

```tsx
import { render, screen, within } from '@testing-library/react';
import { RSRoot, register } from '@rabjs/react';
import type { PublicShareMoment } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { MomentSheetContent } from './moment-sheet';
import { MomentSheetService } from './moment-sheet.service';

// 人物 chip 行与地点行的只读展示（spec people-place §7/§8）：
// - 链内形态（MomentResponse）：persons chips（span 非按钮——不可点，过滤属 M2）+
//   ai 行「AI」角标 + 「📍 name」地点行；
// - exif 坐标待回填（name:null）不显示地点行（偏差 9）；
// - 公开分享形态（PublicShareMoment：两键不存在）两者都不渲染——隐私红线在展示层生效。

vi.mock('@/api/client', () => ({
  client: new Proxy({}, { get: () => () => new Promise(() => undefined) }),
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
register(ComposeSessionService);
register(MomentSheetService);

function moment(partial: {
  persons?: { id: string; name: string; userId: string | null; source: 'manual' | 'ai' }[];
  place?: { lat: number | null; lng: number | null; name: string | null; source: 'manual' | 'exif' | 'ai' } | null;
}) {
  return {
    id: 'm-1',
    chainId: 'chain-1',
    author: { id: 'u-2', nickname: '妈妈', avatarUrl: null },
    type: 'text' as const,
    content: '在外婆家吃饭',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard' as const,
    payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...partial,
  };
}

describe('moment-sheet 人物/地点展示（spec people-place §7）', () => {
  // RSRoot 包裹（timeline-variants/chain-home 既有范式）：useService 需要 RAB 容器上下文。
  // 三个用例均不传 chainName 且 readOnly（Link 渲染路径未触发），无需 MemoryRouter。
  it('链内形态：人物 chips（只读 span）+ AI 角标 + 地点行', () => {
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
        />
      </RSRoot>,
    );
    const group = screen.getByLabelText('和谁在一起');
    expect(within(group).getByText('爸爸')).toBeInTheDocument();
    expect(within(group).getByText('外婆')).toBeInTheDocument();
    expect(within(group).getByText('AI')).toBeInTheDocument();
    // 只读展示：chip 是 span 不是 button（spec §7：点击过滤属 M2，v1 不可点）
    expect(within(group).queryByRole('button')).toBeNull();
    expect(screen.getByText('📍 外婆家')).toBeInTheDocument();
  });

  it('exif 坐标待回填（name:null）→ 不显示地点行（偏差 9）', () => {
    render(
      <RSRoot>
        <MomentSheetContent readOnly moment={moment({ place: { lat: 39.9, lng: 116.4, name: null, source: 'exif' } })} />
      </RSRoot>,
    );
    expect(screen.queryByText(/📍/)).toBeNull();
  });

  it('公开分享形态（无 persons/place 键）→ 两行均不渲染（spec §8 红线在展示层生效）', () => {
    const shared = Object.fromEntries(
      Object.entries(moment({})).filter(([k]) => k !== 'persons' && k !== 'place'),
    ) as PublicShareMoment;
    render(
      <RSRoot>
        <MomentSheetContent readOnly moment={shared} />
      </RSRoot>,
    );
    expect(screen.queryByLabelText('和谁在一起')).toBeNull();
    expect(screen.queryByText(/📍/)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- moment-sheet-people-place.test.tsx`
Expected: FAIL——前两个用例红（`getByLabelText('和谁在一起')` 找不到、`📍 外婆家` 不存在）；第三个用例此刻恰好绿（现状本就不渲染，防回归钉子）。红灯以前两个为准。

- [ ] **Step 3: 实现 moment-sheet.tsx 增量**

Modify `apps/web/src/timeline/moment-sheet.tsx`：

(a) import 区——P2 落地后的 `import { type MomentMedia, type PublicShareMoment } from '@moment/dto';` 替换为：

```ts
import { type MomentMedia, type MomentPlace, type MomentResponse, type PersonBrief, type PublicShareMoment } from '@moment/dto';
```

(b) 组件定义之前追加类型别名：

```ts
/**
 * 卡片可消费的 moment 形态（spec people-place §8）：公开分享路径（PublicShareMoment）
 * 无 persons/place 两键——隐私红线在类型层生效；链内路径传 MomentResponse（超集）。
 */
export type MomentSheetMoment = PublicShareMoment & {
  persons?: PersonBrief[];
  place?: MomentPlace | null;
};
```

(c) `MomentSheetContent` props 的 `moment: PublicShareMoment;` 替换为 `moment: MomentSheetMoment;`。

(d) `openCompose` 调用处——`composeSession.openCompose({ chainId: moment.chainId, edit: moment })` 替换为（cast 理由见计划偏差 8：运行时非 readOnly 路径必为链内完整形态，分享页 readOnly 无编辑入口）：

```ts
                if (key === 'edit') composeSession.openCompose({ chainId: moment.chainId, edit: moment as MomentResponse });
```

(e) 展示块——既有 payload.geo 行（`{(() => { const geo = moment.payload?.geo … })()}`）之后、`{acts}` 之前追加：

```tsx
        {/* 人物与地点（spec people-place §7）：只读展示，不可点击（按人物/地点过滤属 M2）。
            chip 复用词表 chip 形状（rounded-full + text-caption + border-line，非交互 span），
            不新增 token；AI 行角标 text-muted；place 行镜像既有 geo payload 行样式。
            公开分享路径两键不存在（PublicShareMoment），两行自然不渲染（spec §8 红线）。 */}
        {moment.persons && moment.persons.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2" aria-label="和谁在一起">
            {moment.persons.map((p) => (
              <span key={p.id} className="rounded-full border border-line px-3 py-1 text-caption text-ink">
                {p.name}
                {p.source === 'ai' && <span className="ml-1 text-muted">AI</span>}
              </span>
            ))}
          </div>
        )}
        {moment.place?.name && <p className="mt-1 text-meta text-muted">📍 {moment.place.name}</p>}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- moment-sheet-people-place.test.tsx`
Expected: PASS，三个用例全过。

- [ ] **Step 5: 全量回归 + 全端门禁**

Run:
```bash
pnpm --filter @moment/web test && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build
pnpm --filter @moment/api-client typecheck && pnpm --filter @moment/api-client test
```
Expected: 全绿（P2 既有 web 测试 fixture 已含 `persons: []` / `place: null`，展示组件对空集不渲染新行，无回归）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/moment-sheet-people-place.test.tsx
git commit -m "feat(web): show persons and place on moment cards"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/api-client test` / `typecheck` / `lint` / `build` 全绿（persons 四方法 + moments personIds/place payload 钉死）
- [ ] `pnpm --filter @moment/web test` 全绿，含新增：`exif-gps.test.ts`（N/E 正、S/W 负、无 EXIF/垃圾静默、File 切片、多图第一张）、`compose-panel.service.test.ts`（17 个 it：dirty tracking 全分支——未动不带键 / 动作级提交全集 / 删加回升级路径 / place {name} / place null / EXIF {lat,lng} / {name,lat,lng} / 20 上限；词典与成员三路 + 切链清空；EXIF 不覆盖手动名 / 移除 chip 后不回填）、`person-picker.test.tsx`（成员置顶、词典多选 + AI 角标、已选未入册行并入可删、回车新建、前端过滤、EXIF chip 移除）、`moment-sheet-people-place.test.tsx`（只读 chips + AI 角标 + 地点行、exif 待回填不显示、公开形态零渲染）
- [ ] `pnpm --filter @moment/web typecheck` / `lint` / `build` exit 0
- [ ] spec §3 web 端逐条：选图/粘贴/拖拽三路径触发（均汇于 `addImages`）、`file.slice(0, 256*1024)`、exifreader 动态 import、S/W 负、失败静默、多图第一张、chip 可点 × 移除、提交 `{lat, lng}` 无 name
- [ ] spec §6 提交纪律逐条：`personIds`/`place` undefined = 不变（键不存在）、`place: null` = 显式清除、`tagIds` 全量范式未动、无任何 source 字段上送
- [ ] spec §7 UX 边界：无地图选点、无按人物/地点点击过滤（chip 为只读 span）、AI chip 轻标识 + 悬停提示、链成员置顶
- [ ] spec §8：公开分享路径（PublicShareMoment）展示层零 persons/place 渲染
- [ ] 手测清单（编排主 Agent 或用户执行）：
  1. 新建时刻选一张带 GPS 的手机照片 → 「已从照片读取位置」chip 出现；点 × 移除后再加图不复活；粘贴截图/拖拽同样触发
  2. 人物选择器：链成员 chip 置顶选中即建 person（重复选择不重复建）；输入过滤词典；回车新建重名不报错（幂等命中）；编辑带 AI 人物的时刻 → 「AI」角标可见、悬停有提示
  3. 编辑一条带 AI 人物 + exif 地点的时刻，只改正文保存 → 响应/DB 中 ai 行 source 与 place_source 不变（不升级）
  4. 编辑中删除全部人物保存 → 人物清空；清空地点名 + 移除 chip 保存 → place 三列清空
  5. 时间线卡片与详情页显示人物 chip 行与 📍 地点行；公开分享链接页两者皆无
  6. 浅色/深色主题、390px 视口下选择器与 chip 可用
- [ ] Produces 符号逐个可解析：`MomentClient.listPersons/createPerson/renamePerson/removePerson`、`GpsCoords`、`extractGpsCoords`、`parseExifGps`、`readGpsFromFile`、`firstGps`、`ComposePanelService` 新状态与方法（Task 3 Interfaces 全列）、`PersonPicker`、`MomentSheetMoment`

## 写完自查（起草者已执行）

- **spec 覆盖**：§3 web 小节逐条（时机/切片/动态 import/十进制与 S/W/静默/多图第一张/chip 可移除/提交无 name）；§3 安全信任边界（不传 source、坐标防御性范围检查、server 仍有一层 400）；§6 客户端提交纪律三条（personIds/place 判脏、tagIds 不动、timeEdited 先例对齐）；§7 编辑器与卡片全部 UX 条目 + 「明确不做」清单（无地图选点/无过滤/无合并）；§8 展示层红线；§9 web/app 测试策略条目（组件测试按 web 既有 vitest+jsdom+RTL 范式、EXIF fixture buffer 单测）；§11 P5 出口标准。
- **占位符扫描**：无 TBD / TODO /「适当处理」/「类似 Task N」。
- **跨 Task 类型一致性**：Consumes 符号与 P1/P2 Produces 逐字核对（`PersonBrief`/`MomentPlace`/`PersonResponse`/`PersonListResponse`/`PersonCreateInput`/`PersonPatchInput`/`PublicShareMoment`/`MomentResponse.persons: PersonBrief[]`/`place: MomentPlace | null`）；Task 2 的 `firstGps`/`GpsCoords` 被 Task 3 消费（含测试 mock 的模块路径 `@/compose/exif-gps` 一致）；Task 1 的 `client.listPersons/createPerson/listMembers` 被 Task 3/4 消费；Task 3 的 service 状态字段名与 Task 4 组件/测试逐字一致（`personList`/`members`/`selectedPersons`/`personQuery`/`placeName`/`placeCoords`/`personsTouched`/`placeTouched`/`exifDismissed`）；`ChainMemberDto` 字段（userId/nickname/avatarUrl/role/joinedAt）与 dto `chains.ts` 现状核对。
- **web 组件测试基建现状**：有成熟范式可循——vitest 4 + jsdom + @testing-library/react + user-event（`apps/web/vitest.config.ts` + `src/test/setup.ts`，组件契约测试就近放源码旁）；服务层测试范式见 `chain-settings.service.test.ts`（`vi.mock('@/api/client')` + `register`/`resolve` 直接调方法）、组件测试范式见 `chain-home.test.tsx`（全局容器注册 + 渲染前播种 + 交互断言 service 状态/api 调用）；jsdom 缺口两条已按既有约定处理：`URL.createObjectURL` 打桩（create-chain-dialog 同款）、RAB 属性变更不触发 observer 重渲（断言走 service 状态而非重渲染 DOM）。
