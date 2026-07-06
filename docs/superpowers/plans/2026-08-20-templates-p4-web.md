# 链模板系统 P4：web 模板感知 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web 端接入链模板系统：创建链选模板、发布面板按 manifest 动态渲染扩展字段与结构化记录、链主页聚合视图（曲线/里程碑轴/心情线/行程分章/地图）、分享只读页模板视图。

**Architecture:** 全部模板感知 UI 由 manifest 驱动——发布面板渲染 `momentFields`（字段词表）与 `kinds[].publisher` 入口，kind 表单由 payloadSchema 的受限子集（enum→chips、number→数字输入、string→文本输入、milestoneCatalog→目录 chips）通用渲染，**禁止按模板 key 硬编码 UI**（spec §5）。聚合数据走 P3 的 `GET /api/chains/:chainId/aggregate`；timeline 分章不走端点，用已加载 moments + 链 payload.trips 前端分组（P3 Global Constraints）。视觉只消费 `tokens.css` 语义 token 与 `src/ui/` 设计系统组件。

**Tech Stack:** React 19 + Vite / @rabjs/react（Service 模式）/ @moment/api-client / leaflet + react-leaflet（仅地图视图）/ vitest（纯函数单测）。

**Spec:** `docs/superpowers/specs/2026-08-20-chain-templates-design.md`（§1.3 manifest DSL、§4 三模板、§5 各端 UX）

## Global Constraints

- 执行 prompt T5 契约：`docs/superpowers/prompts/2026-08-20-chain-templates-execution.md`。
- 上游契约（已评审通过）：dto 的 `TemplateManifest` / `TemplateMomentField` / `TemplateDto` / `AggregateResponse` / `aggregateQuerySchema` / `ChainDetailDto`（P1+P3 Task 1）；server 端点 `GET /api/templates?scope=` / `GET /api/chains/:chainId/aggregate?view=&kind=&field=` / 分享响应附 `template`+`templateManifest`+`aggregates`（P2/P3）。
- **词表渲染器纪律（spec §5）**：所有模板感知 UI 按 manifest 字段/视图词表通用渲染；代码中禁止出现 `template === 'baby'` 这类按模板 key 的分支。允许的数据驱动特例：`chain.payload?.birthdate` 存在即显示年龄标注（spec §4：年龄是展示层能力，由数据存在性驱动而非模板 key）。
- **六份 C 端设计规范是唯一视觉真相源**：只用 `src/ui/` 的 Button/Field/Modal/Menu/Feedback 组件与 tokens.css 语义 token；禁止写死色值、一次性尺寸（`px-[18px]`）、负边距通栏（`.claude/rules/web-ui.md`）。
- rab 纪律（`apps/web/CLAUDE.md`）：全局 Service 在 `src/services/`；页面组件 `index.tsx` + 同目录 `.service.ts`；跨域刷新只走 `'global'` 事件；禁止解构 observable；所有 API 访问经 `src/api/client.ts` 的 `client`。
- **S4 约束（P3 评审，必须继承）**：PATCH moment 只改 kind 不改 payload 会被 server 拒（旧 payload 按新 kind 校验不过）。本计划实现为：**编辑模式不允许切换 kind**；提交编辑时始终显式携带当前 `kind` + 编辑后的 `payload`（无扩展字段时显式 `null`），杜绝隐式中间态。
- **kind moment 的正文兜底（产品决策，本计划补齐）**：dto 约束 text 类型 content 必填。kind ≠ standard 且正文留空时，提交前用结构摘要兜底填入 content（里程碑用 label、metric 用「身高 62cm」式摘要），server 契约不变。
- 媒体 URL 一律相对路径 + 分享页 `?st=` token 通道（既有约定，不新增绝对域名）。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。
- web 门禁（CONVENTIONS §4）：`pnpm --filter @moment/web test` / `typecheck` / `build` / `lint` + 手动验收清单（本计划 DoD）。每 Task 至少跑 typecheck + lint（评审 S1）；唯一例外是 Task 1——P3 中间态未收口，typecheck 做基线核对（报错白名单逐条核对，不追求 exit 0），Task 2 收口后恢复全绿门禁。

---

### Task 1: api-client 模板方法 + 地图依赖与环境变量

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `apps/web/package.json`（加依赖）、`apps/web/src/env.d.ts`、`apps/web/.env.example`
- Test: 无（api-client 改动由 web typecheck 与后续 Task 的实际调用覆盖；packages/api-client 无独立测试命令，沿用既有惯例）

**Interfaces:**
- Consumes: dto 的 `TemplateDto` / `TemplateScope` / `AggregateResponse` / `AggregateQuery` / `ChainDetailDto`；既有 `Http.request`（`query?: Record<string, string | number | undefined>`）。
- Produces（web 全部后续 Task 消费，不得改名）:
  - `MomentClient.listTemplates(scope?: TemplateScope): Promise<TemplateDto[]>`
  - `MomentClient.getChain(chainId: string): Promise<ChainDetailDto>`（返回类型从 `ChainDto` 收窄为超集 `ChainDetailDto`——`ChainDetailDto extends ChainDto`，既有调用方类型不受影响）
  - `MomentClient.getAggregate(chainId: string, query: AggregateQuery): Promise<AggregateResponse>`
  - 环境变量 `VITE_MAP_TILE_URL`（地图栅格 tile 地址，缺省 OSM）

- [ ] **Step 1: 改 api-client**

Modify `packages/api-client/src/client.ts`：
- import 类型列表追加 `AggregateQuery`、`AggregateResponse`、`ChainDetailDto`、`TemplateDto`、`TemplateScope`。
- `MomentClient` 接口 `getChain` 行改为：
  ```ts
  /** P3 起链详情内嵌 templateManifest（ChainDetailDto ⊃ ChainDto，向后兼容） */
  getChain(chainId: string): Promise<ChainDetailDto>;
  ```
  并在 `getChain` 行后追加：
  ```ts
  /** 模板列表（scope=official 取官方三模板；不传 = official 全部 + 我的 user 模板） */
  listTemplates(scope?: TemplateScope): Promise<TemplateDto[]>;
  /** 聚合视图投影（spec §3.2）；timeline 不走端点（前端分章），请求会得 INVALID_AGGREGATE_VIEW */
  getAggregate(chainId: string, query: AggregateQuery): Promise<AggregateResponse>;
  ```
- 实现对象 `getChain` 行后追加：
  ```ts
  listTemplates: (scope) => http.request('/api/templates', { query: { scope } }),
  getAggregate: (chainId, query) =>
    http.request(`/api/chains/${chainId}/aggregate`, {
      query: { view: query.view, kind: query.kind, field: query.field },
    }),
  ```

- [ ] **Step 2: 加地图依赖与环境变量**

Run:
```bash
pnpm --filter @moment/web add leaflet@^1.9.4 react-leaflet@^5.0.0
pnpm --filter @moment/web add -D @types/leaflet
```
Expected: exit 0；`apps/web/package.json` dependencies 增 `leaflet` / `react-leaflet`，devDependencies 增 `@types/leaflet`。（react-leaflet v5 支持 React 19；leaflet 默认 marker 图标资源在 Vite 下会丢，本计划一律用 `CircleMarker`，不引图标资源。）

Modify `apps/web/src/env.d.ts`——`ImportMetaEnv` 接口内追加：
```ts
  /** 地图栅格 tile URL（含 {z}/{x}/{y} 占位）；缺省用 OSM 公共 tile */
  readonly VITE_MAP_TILE_URL?: string;
```

Modify `apps/web/.env.example`——末尾追加：
```
# 地图栅格 tile 地址（旅行模板足迹地图）。留空 = OpenStreetMap 公共 tile；生产建议换自建/商用 tile 服务。
VITE_MAP_TILE_URL=
```

- [ ] **Step 3: 运行确认（typecheck 基线核对，非全绿——P3 中间态由 Task 2 收口）**

Run:
```bash
pnpm --filter @moment/web lint
pnpm --filter @moment/web typecheck
```
Expected: lint exit 0；typecheck **预期非零**——P3 合入后的中间态，报错必须且只能来自这 6 处（逐条核对，出现第 7 处即停手报告）：
1. `src/shell/create-chain-dialog/create-chain-dialog.service.ts`——`createChain` 入参缺 `template`（Task 2 Step 2 修复）
2. `src/pages/chain-home/chain-home.test.tsx`——CHAIN 缺 template/payload、两个 moment 字面量缺 kind/payload（Task 2 Step 1 修复）
3. `src/pages/timeline-variants.test.tsx`——CHAIN 缺 template/payload、TEXT_MOMENT 缺 kind/payload（Task 2 Step 1 修复；CHAIN_B/TWO_IMAGE_MOMENT 走 spread 继承，无需改）
4. `src/lib/memories.test.ts`——moment 工厂缺 kind/payload（Task 2 Step 1 修复）
5. `src/memories/memories-entry.test.tsx`——moment 工厂缺 kind/payload（Task 2 Step 1 修复）
6. `src/memories/memories.service.test.ts`——moment 工厂缺 kind/payload（Task 2 Step 1 修复）

（本 Task 不跑 build/test 作为门禁：typecheck 红则 build 必红；vitest 不经类型检查，绿不证明字面量已修。）

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/api-client/src/client.ts apps/web/package.json apps/web/src/env.d.ts apps/web/.env.example pnpm-lock.yaml
git commit -m "feat(web): add template and aggregate client methods with map deps"
```

---

### Task 2: 创建链选模板（修复 P3 中间态）

**Files:**
- Modify: `apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.ts`
- Modify: `apps/web/src/shell/create-chain-dialog/index.tsx`
- Modify（P3 中间态连带修复，dto 必填字段生效后保持 typecheck 绿）:
  - `apps/web/src/pages/chain-home/chain-home.test.tsx`（L100 CHAIN、L119 TEXT_MOMENT、L139 IMAGE_MOMENT）
  - `apps/web/src/pages/timeline-variants.test.tsx`（L114 CHAIN、L132 TEXT_MOMENT；L130 CHAIN_B 与 L153 TWO_IMAGE_MOMENT 走 spread 继承，无需改）
  - `apps/web/src/lib/memories.test.ts`（L7 moment 工厂）
  - `apps/web/src/memories/memories-entry.test.tsx`（L46 moment 工厂）
  - `apps/web/src/memories/memories.service.test.ts`（L19 moment 工厂）

**Interfaces:**
- Consumes: Task 1 的 `client.listTemplates`；dto `TemplateDto` / `ChainDetailDto`；ui/modal `Dialog`、ui/field `Field/Input/Textarea`、ui/feedback `Banner`（既有用法照本文件现状）。
- Produces: `CreateChainDialogService.templates: TemplateDto[]`、`.template: string`（默认 `'daily'`）、`.loadTemplates(): Promise<void>`；创建提交体含 `template`（P3 起 server 必填，本 Task 修复 web 侧中间态）。

- [ ] **Step 1: 修五个测试文件的 dto 必填字段（P3 中间态，评审 B1/B2）**

1. `apps/web/src/pages/chain-home/chain-home.test.tsx`：
   - import 行 `import type { ChainDto, MomentMedia, MomentResponse, UserProfile } from '@moment/dto';` 中 `ChainDto` 改为 `ChainDetailDto`
   - L100 `const CHAIN: ChainDto = {` 改为 `const CHAIN: ChainDetailDto = {`，并在 `visibility: 'private',` 行后加三字段（ChainDetailDto 全量键，无 excess property check 冲突）：
     ```ts
       template: 'daily',
       payload: null,
       templateManifest: { version: 1 },
     ```
   - L171 `service.chain = CHAIN;` 无需改（CHAIN 类型升级后恰好匹配 service 的 ChainDetailDto 字段，见 Task 5 Step 1）
   - L119 TEXT_MOMENT 与 L139 IMAGE_MOMENT 各自的 `type: '...',` 行后加：
     ```ts
       kind: 'standard',
       payload: null,
     ```
2. `apps/web/src/pages/timeline-variants.test.tsx`：
   - L114 `const CHAIN: ChainDto = {` 注解不变（本文件 CHAIN 只喂 timeline/分享场景，不赋给 ChainHomeService.chain），在 `visibility: 'private',` 行后加 `template: 'daily',` 与 `payload: null,`
   - L132 TEXT_MOMENT 的 `type: 'text',` 行后加 `kind: 'standard',` 与 `payload: null,`
   - L130 CHAIN_B（`{ ...CHAIN, ... }`）与 L153 TWO_IMAGE_MOMENT（`{ ...TEXT_MOMENT, ... }`）spread 自动继承新字段，**不改**
   - L205 `service.chain = { name: ..., description: ... }` 是 ShareAlbumService 的 `PublicShareChain`（仅 name/description），不受 dto 变更影响，**不改**
3. `apps/web/src/lib/memories.test.ts` L7、`apps/web/src/memories/memories-entry.test.tsx` L46、`apps/web/src/memories/memories.service.test.ts` L19：三个 moment 工厂返回字面量的 `type: 'text',` 行后各加 `kind: 'standard',` 与 `payload: null,`

- [ ] **Step 2: 改 service**

Modify `apps/web/src/shell/create-chain-dialog/create-chain-dialog.service.ts`——类内字段区（`icon` 行后）追加：
```ts
  /** 官方模板候选（scope=official）；打开对话框时加载 */
  templates: TemplateDto[] = [];
  /** 选中的模板 key（spec §0：创建时选定不可改）；默认日常生活 */
  template = 'daily';
```
import 块 `import type { ChainColor, ChainIcon } from '@moment/dto';` 改为 `import type { ChainColor, ChainIcon, TemplateDto } from '@moment/dto';`。

`submit` 方法的 `client.createChain({...})` 入参加 `template: this.template,`（`name` 行后）。

类末尾追加：
```ts
  /** 打开对话框时调用：拉官方模板（失败静默——列表为空时选择器不渲染，仍可建 daily 链） */
  async loadTemplates(): Promise<void> {
    this.templates = await client.listTemplates('official');
  }
```

- [ ] **Step 3: 改对话框 UI**

Modify `apps/web/src/shell/create-chain-dialog/index.tsx`：
- import 区加 `import { useEffect } from 'react';`（并入既有 react import）与 `import type { TemplateDto } from '@moment/dto';`（无需——templates 已从 service 读，类型不直接引用则省略）。
- `CreateChainDialogContent` 内 `const [error, setError] = ...` 行后加：
  ```tsx
  useEffect(() => {
    void service.loadTemplates().catch(() => undefined); // 失败静默：选择器不渲染，默认 daily
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载时一次性加载
  }, []);
  ```
- `<Field label="名字">` 之前插入模板选择器（词表驱动：卡片数据全部来自 `service.templates`，不写死三个模板）：
  ```tsx
  {service.templates.length > 0 && (
    <Field label="这条链记什么" description="模板选定后不可更改">
      <div className="grid grid-cols-3 gap-2">
        {service.templates.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={service.template === t.key}
            onClick={() => (service.template = t.key)}
            className={`flex flex-col items-start gap-1 rounded-surface-md border px-3 py-2 text-left transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
              service.template === t.key
                ? 'border-action bg-bg'
                : 'border-line bg-surface hover:bg-floating-hover'
            }`}
          >
            <span className="text-body">
              {t.icon} {t.name}
            </span>
            {t.description && <span className="text-caption text-muted">{t.description}</span>}
          </button>
        ))}
      </div>
    </Field>
  )}
  ```

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```
Expected: 均 exit 0。**此 Task 后 P3 遗留的 web typecheck 中间态（createChain 缺 template + 五个测试文件缺 dto 必填字段）全部消除。**

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/shell/create-chain-dialog/ apps/web/src/pages/chain-home/chain-home.test.tsx apps/web/src/pages/timeline-variants.test.tsx apps/web/src/lib/memories.test.ts apps/web/src/memories/memories-entry.test.tsx apps/web/src/memories/memories.service.test.ts
git commit -m "feat(web): pick chain template on creation"
```

---

### Task 3: 模板纯函数库（年龄标注 / 行程分章 / payload 组装）+ 单测

**Files:**
- Create: `apps/web/src/lib/template.ts`
- Test: `apps/web/src/lib/template.test.ts`

**Interfaces:**
- Consumes: dto 的 `TemplateManifest` / `TemplateMomentField` / `MomentResponse`；`@/lib/time` 的 `localDateKey`。
- Produces（Task 4/5/6 消费，不得改名）:
  - `babyAgeLabel(birthdate: string, happenedAtIso: string, tzOffsetMinutes: number): string`——「3 个月」「1 岁 2 个月」「4 岁」式年龄标注（spec §4 展示层能力）
  - `interface TripSection { name: string; start: string; end: string; moments: MomentResponse[] }`、`groupMomentsByTrips(moments: MomentResponse[], trips: { name: string; start: string; end: string }[]): { sections: TripSection[]; outside: MomentResponse[] }`——按发生地墙钟日落章
  - `summarizePayload(manifest: TemplateManifest, kind: string, payload: Record<string, unknown> | null): string`——kind moment 的正文兜底摘要（milestone→label，metric→「身高 62cm」）；standard 或无 payload 返回 `''`
  - `resolveMilestoneLabel(manifest: TemplateManifest, payload: Record<string, unknown>): { label: string; icon: string | null }`——catalog_key 查目录，custom_label 回退（与 P3 server milestone-axis 投影同规则）

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/lib/template.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { OFFICIAL_TEMPLATES, type MomentResponse } from '@moment/dto';
import { babyAgeLabel, groupMomentsByTrips, resolveMilestoneLabel, summarizePayload } from './template';

const baby = OFFICIAL_TEMPLATES.find((t) => t.key === 'baby')!.manifest;

function momentAt(id: string, iso: string, tz = -480): MomentResponse {
  return { id, happenedAt: iso, happenedTzOffset: tz } as MomentResponse;
}

describe('babyAgeLabel', () => {
  it('未满岁按月；满岁按岁+月；整岁只显示岁', () => {
    expect(babyAgeLabel('2026-01-15', '2026-04-20T02:00:00.000Z', -480)).toBe('3 个月');
    expect(babyAgeLabel('2025-01-10', '2026-04-20T02:00:00.000Z', -480)).toBe('1 岁 3 个月');
    expect(babyAgeLabel('2022-04-20', '2026-04-20T02:00:00.000Z', -480)).toBe('4 岁');
  });

  it('按发生地墙钟日计算（UTC 跨日不串）', () => {
    // UTC 4-30 16:30 = 东八区 5-01 00:30 → 按 5 月 1 日算
    expect(babyAgeLabel('2026-01-01', '2026-04-30T16:30:00.000Z', -480)).toBe('4 个月');
  });
});

describe('groupMomentsByTrips', () => {
  const trips = [
    { name: '云南', start: '2026-05-01', end: '2026-05-05' },
    { name: '东京', start: '2026-06-10', end: '2026-06-15' },
  ];

  it('墙钟日落入对应行程；行程外进 outside；章节按 start 倒序', () => {
    const inYunnan = momentAt('a', '2026-05-02T16:00:00.000Z'); // 东八区 5-03
    const inTokyo = momentAt('b', '2026-06-12T01:00:00.000Z'); // 东八区 6-12
    const outside = momentAt('c', '2026-07-01T00:00:00.000Z');
    const { sections, outside: out } = groupMomentsByTrips([inYunnan, inTokyo, outside], trips);
    expect(sections.map((s) => s.name)).toEqual(['东京', '云南']);
    expect(sections[0]!.moments.map((m) => m.id)).toEqual(['b']);
    expect(sections[1]!.moments.map((m) => m.id)).toEqual(['a']);
    expect(out.map((m) => m.id)).toEqual(['c']);
  });

  it('行程边界含首尾日；无行程时全部 outside', () => {
    const first = momentAt('a', '2026-04-30T16:30:00.000Z'); // 东八区 5-01
    const last = momentAt('b', '2026-05-05T15:59:00.000Z'); // 东八区 5-05 23:59
    const { sections } = groupMomentsByTrips([first, last], trips);
    expect(sections.find((s) => s.name === '云南')!.moments).toHaveLength(2);
    expect(groupMomentsByTrips([first], []).outside).toHaveLength(1);
  });
});

describe('resolveMilestoneLabel / summarizePayload', () => {
  it('catalog_key 命中目录给 label+icon；custom_label 回退；未知 key 用原文', () => {
    expect(resolveMilestoneLabel(baby, { catalog_key: 'first-smile' })).toEqual({ label: '第一次微笑', icon: '😊' });
    expect(resolveMilestoneLabel(baby, { custom_label: '第一次叫妈妈' })).toEqual({ label: '第一次叫妈妈', icon: null });
    expect(resolveMilestoneLabel(baby, { catalog_key: 'not-in-catalog' })).toEqual({ label: 'not-in-catalog', icon: null });
  });

  it('summarizePayload：milestone 用 label；metric 用中文摘要；standard 返回空串', () => {
    expect(summarizePayload(baby, 'milestone', { catalog_key: 'first-steps' })).toBe('第一次走路');
    expect(summarizePayload(baby, 'metric', { metric: 'height', value: 62, unit: 'cm' })).toBe('身高 62cm');
    expect(summarizePayload(baby, 'metric', { metric: 'weight', value: 7.5, unit: 'kg' })).toBe('体重 7.5kg');
    expect(summarizePayload(baby, 'standard', { mood: '😄' })).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/web test -- src/lib/template.test.ts`
Expected: FAIL，模块 `./template` 不存在。

- [ ] **Step 3: 实现纯函数库**

Create `apps/web/src/lib/template.ts`：
```ts
import type { MomentResponse, TemplateManifest } from '@moment/dto';
import { localDateKey } from './time';

// 模板相关的纯函数（页面私有逻辑下沉 lib，web CLAUDE.md 放置约束）。
// 全部由 manifest/payload 数据驱动，不出现模板 key 硬编码（spec §5 词表渲染器纪律）。

/** 行程定义（travel 模板链 payload.trips 的元素形状；与 dto chainPayloadSchema 对应）。 */
export interface Trip {
  name: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
}

/**
 * 宝宝年龄标注（spec §4：birthdate + happened_at 计算，不落库）。
 * 按发生地墙钟日算整月差：日不足向前借一月。未满 1 岁「N 个月」，否则「N 岁 M 个月」（M=0 只显示岁）。
 */
export function babyAgeLabel(birthdate: string, happenedAtIso: string, tzOffsetMinutes: number): string {
  const wall = localDateKey(happenedAtIso, tzOffsetMinutes);
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [wy, wm, wd] = wall.split('-').map(Number);
  if (!by || !wy) return '';
  let months = (wy - by) * 12 + (wm - bm);
  if (wd < bd) months -= 1;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${months} 个月`;
  return rest === 0 ? `${years} 岁` : `${years} 岁 ${rest} 个月`;
}

export interface TripSection extends Trip {
  moments: MomentResponse[];
}

/**
 * 行程分章（travel 模板 timeline 视图 groupBy:'trips'）：按发生地墙钟日落章，
 * 含首尾日；章节按 start 倒序（新的在前，与时间线同向）；不属于任何行程的进 outside。
 */
export function groupMomentsByTrips(
  moments: MomentResponse[],
  trips: Trip[],
): { sections: TripSection[]; outside: MomentResponse[] } {
  const sections: TripSection[] = [...trips]
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .map((t) => ({ ...t, moments: [] }));
  const outside: MomentResponse[] = [];
  for (const m of moments) {
    const day = localDateKey(m.happenedAt, m.happenedTzOffset);
    const section = sections.find((s) => day >= s.start && day <= s.end);
    if (section) section.moments.push(m);
    else outside.push(m);
  }
  return { sections, outside };
}

/** catalog_key → 目录 label/icon；custom_label / 未知 key 回退原文（与 server milestone-axis 投影同规则）。 */
export function resolveMilestoneLabel(
  manifest: TemplateManifest,
  payload: Record<string, unknown>,
): { label: string; icon: string | null } {
  const catalogKey = typeof payload.catalog_key === 'string' ? payload.catalog_key : undefined;
  const hit = catalogKey ? (manifest.milestoneCatalog ?? []).find((c) => c.key === catalogKey) : undefined;
  if (hit) return { label: hit.label, icon: hit.icon ?? null };
  if (typeof payload.custom_label === 'string') return { label: payload.custom_label, icon: null };
  return { label: catalogKey ?? '', icon: null };
}

/** metric 枚举值 → 中文摘要名（词表内已知值的展示文案；未知值用原文）。组件共享，避免各写一份。 */
export const METRIC_LABELS: Record<string, string> = { height: '身高', weight: '体重' };

/**
 * kind moment 的正文兜底摘要（Global Constraints：text 类型 content 必填，
 * 用户只填结构化字段时用它兜底）。standard / 无法摘要时返回 ''（调用方不兜底）。
 */
export function summarizePayload(
  manifest: TemplateManifest,
  kind: string,
  payload: Record<string, unknown> | null,
): string {
  if (!payload) return '';
  if (kind === 'milestone') return resolveMilestoneLabel(manifest, payload).label;
  const metric = typeof payload.metric === 'string' ? payload.metric : undefined;
  if (metric !== undefined && typeof payload.value === 'number') {
    const unit = typeof payload.unit === 'string' ? payload.unit : '';
    return `${METRIC_LABELS[metric] ?? metric} ${payload.value}${unit}`;
  }
  return '';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/web test -- src/lib/template.test.ts && pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build`
Expected: PASS（6 个 it 全过）；typecheck / lint / build 均 exit 0（评审 S1：门禁口径与 Global Constraints 一致）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/lib/template.ts apps/web/src/lib/template.test.ts
git commit -m "feat(web): add template pure helpers for age trips and payload"
```

---

### Task 4: 发布面板词表渲染器（momentFields + kinds + 编辑模式 S4）

**Files:**
- Create: `apps/web/src/compose/template-fields.tsx`（词表字段渲染器组件）
- Modify: `apps/web/src/compose/compose-panel/compose-panel.service.ts`
- Modify: `apps/web/src/compose/compose-panel/index.tsx`
- Test: 无组件测试（门禁 = typecheck/lint/build + DoD 手动验收；payload 组装逻辑已抽进 Task 3 的 lib 并测过）

**Interfaces:**
- Consumes: Task 1 的 `client.getChain`（ChainDetailDto 内嵌 manifest）；Task 3 的 `summarizePayload`；dto 的 `TemplateManifest` / `TemplateMomentField`；ui 组件 Button/Field/Input/Banner。
- Produces:
  - `ComposePanelService` 增 `manifest: TemplateManifest | null`、`kind: string`（默认 `'standard'`）、`payloadDraft: Record<string, unknown>`、`loadManifest(chainId): Promise<void>`、`pickChain(chainId): void`（切链重置结构化状态，评审 H4）、`setKind(kind: string): void`、`setFieldValue(key: string, value: unknown): void`、`geoBusy: boolean`、`pickGeo(): Promise<void>`
  - `<TemplateFields service manifest edit>` 组件：按 manifest 渲染 momentFields（emoji-picker/geo/enum/date/number-unit/text）与 kinds publisher 入口 + kind payload 表单
  - 提交体：创建时含 `kind` + `payload`（无扩展值则省略 payload）；编辑时始终显式 `kind`（原值，不可改）+ `payload`（S4）

- [ ] **Step 1: service 接入 manifest 与 kind/payload 草稿**

Modify `apps/web/src/compose/compose-panel/compose-panel.service.ts`：
- import 块加：
  ```ts
  import type { TemplateManifest } from '@moment/dto';
  import { summarizePayload } from '@/lib/template';
  ```
- 字段区（`tagList` 行后）加：
  ```ts
  /** 当前链的模板 manifest（链详情内嵌，spec §3.2）；null = 未加载或无扩展 */
  manifest: TemplateManifest | null = null;
  /** 结构化类别（spec §1.1）；standard = 普通 moment。编辑模式锁定为原 kind（S4：不允许切 kind） */
  kind = 'standard';
  /** momentFields / kind payload 的草稿值；key 与 manifest 声明一致 */
  payloadDraft: Record<string, unknown> = {};
  geoBusy = false;
  private manifestChainId = '';
  ```
- `hydrate` 方法末尾（`this.selectedTags = ...` 行后）加：
  ```ts
    // 编辑模式：kind 锁定原值，payload 草稿从既有值水合（S4：提交时 kind+payload 始终显式携带）
    this.kind = request.edit?.kind ?? 'standard';
    this.payloadDraft = { ...(request.edit?.payload ?? {}) };
    this.manifest = null;
    this.manifestChainId = '';
  ```
- `loadTagList` 后加：
  ```ts
  /** 面板内切链（评审 H4）：重置结构化状态——旧链的 kind/payload 草稿对新链模板无意义；
   *  manifest 置 null 使 TemplateFields 在新 manifest 到达前不渲染（await 期间无旧表单可提交）。 */
  pickChain(chainId: string): void {
    if (this.pickedChainId === chainId) return;
    this.pickedChainId = chainId;
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
  }

  /** 链切换时拉模板 manifest（链详情内嵌；同链幂等）。失败静默：无扩展字段可填，主流程不阻塞。 */
  async loadManifest(chainId: string): Promise<void> {
    if (!chainId || this.manifestChainId === chainId) return;
    this.manifestChainId = chainId;
    const detail = await client.getChain(chainId);
    // 异步返回时链已切换则丢弃（防串链）
    if (this.chainId === chainId) this.manifest = detail.templateManifest;
  }

  /** 切 kind（仅新建；编辑模式 UI 不提供入口）。切走清空草稿，防旧值按新 kind 校验不过（S4 推论）。 */
  setKind(kind: string): void {
    this.kind = kind;
    this.payloadDraft = {};
  }

  /** momentField / kind 字段值写入草稿；undefined 表示清除该 key */
  setFieldValue(key: string, value: unknown): void {
    const next = { ...this.payloadDraft };
    if (value === undefined) delete next[key];
    else next[key] = value;
    this.payloadDraft = next;
  }

  /** geo 字段：浏览器定位（Geolocation API）；失败写 error，草稿不留半成品 */
  async pickGeo(fieldKey: string): Promise<void> {
    if (!('geolocation' in navigator)) {
      this.error = '这个浏览器不支持定位';
      return;
    }
    this.geoBusy = true;
    this.error = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000 }),
      );
      const prev = this.payloadDraft[fieldKey] as { place_name?: string } | undefined;
      this.setFieldValue(fieldKey, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ...(prev?.place_name ? { place_name: prev.place_name } : {}),
      });
    } catch {
      this.error = '没拿到定位，检查一下浏览器权限';
    } finally {
      this.geoBusy = false;
    }
  }
  ```
- `submit` 的创建分支：`this.progress = '记下…';` 后、`client.createMoment` 调用处改为：
  ```ts
        this.progress = '记下…';
        const hasPayload = Object.keys(this.payloadDraft).length > 0;
        // kind moment 正文兜底（Global Constraints）：正文空时用结构摘要，满足 text 类型 content 必填。
        // 兜底填入的摘要与 Task 5 卡片摘要行逐字相同——卡片侧按 content===summary 判重跳过（评审 H1），不重复显示
        const summary = this.kind !== 'standard' ? summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft) : '';
        if (this.kind !== 'standard' && this.content.trim().length === 0 && !summary && !hasImages && !hasVideo) {
          // 摘要也为空时不发空 content 给 server 被 400（CONTENT_REQUIRED），前置人话提示（评审 S8）
          this.error = '选一项或写一句，再记下';
          this.progress = null;
          return;
        }
        const content = this.content.trim().length === 0 && this.kind !== 'standard' ? summary : this.content;
        const res = await client.createMoment(chainId, {
          type,
          content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill,
          mediaIds,
          tagIds: this.selectedTags,
          kind: this.kind,
          ...(hasPayload ? { payload: this.payloadDraft } : {}),
        });
  ```
  注意：正文为空的校验在方法前段（`先写一句此刻吧`）——kind ≠ standard 时不应被它拦。把前段校验改为：
  ```ts
    const structuredOnly = this.kind !== 'standard';
    if (!hasImages && !hasVideo && this.content.trim().length === 0 && !structuredOnly) {
      this.error = '先写一句此刻吧';
      return;
    }
  ```
- `submit` 的编辑分支：`client.updateMoment(edit.id, {...})` 入参末尾加（S4：kind 原值 + payload 始终显式）：
  ```ts
          kind: edit.kind,
          payload: Object.keys(this.payloadDraft).length > 0 ? this.payloadDraft : null,
  ```

- [ ] **Step 2: 词表字段渲染器组件**

Create `apps/web/src/compose/template-fields.tsx`：
```tsx
import { observer } from '@rabjs/react';
import { MapPin } from 'lucide-react';
import type { TemplateManifest, TemplateMomentField } from '@moment/dto';
import { Button } from '@/ui/button/index';
import { Field, Input } from '@/ui/field/index';
import type { ComposePanelService } from './compose-panel/compose-panel.service';

// 词表通用渲染器（spec §5 硬纪律）：按 manifest 的 momentFields / kinds 声明渲染，
// 不出现模板 key 分支。kind 表单渲染 payloadSchema 的受限子集：
// enum → chips、number → 数字输入、其余 string → 文本输入；payloadSchema 有 catalog_key
// 且 manifest 带 milestoneCatalog 时渲染目录 chips。词表/schema 子集外的声明静默不渲染
// （server 是最终校验，web 只做录入辅助）。

const CHIP_BASE =
  'rounded-full border px-3 py-1 text-caption transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus';
const CHIP_ON = 'border-transparent bg-select text-select-fg';
const CHIP_OFF = 'border-line text-ink hover:bg-floating-hover';

/** 词表内已知枚举值的展示文案（lib/template 的 METRIC_LABELS 超集；未知值用原文）。 */
const ENUM_LABELS: Record<string, string> = {
  height: '身高',
  weight: '体重',
  cm: 'cm',
  kg: 'kg',
  boy: '男宝',
  girl: '女宝',
  unknown: '未知',
};

/** 单个 momentField 的词表渲染（emoji-picker/geo/enum/date/number-unit/text）。 */
const MomentFieldControl = observer(function MomentFieldControl({
  service,
  field,
}: {
  service: ComposePanelService;
  field: TemplateMomentField;
}) {
  const value = service.payloadDraft[field.key];

  if (field.type === 'emoji-picker' || field.type === 'enum') {
    const options = field.options ?? [];
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={field.label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            onClick={() => service.setFieldValue(field.key, value === opt ? undefined : opt)}
            className={`${CHIP_BASE} ${value === opt ? CHIP_ON : CHIP_OFF}`}
          >
            {field.type === 'emoji-picker' ? opt : (ENUM_LABELS[opt] ?? opt)}
          </button>
        ))}
      </div>
    );
  }

  if (field.type === 'geo') {
    const geo = value as { lat: number; lng: number; place_name?: string } | undefined;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            leadingIcon={MapPin}
            loading={service.geoBusy}
            onClick={() => void service.pickGeo(field.key)}
          >
            {geo ? '重新定位' : field.label}
          </Button>
          {geo && (
            <span className="text-meta text-muted">
              已添加位置（{geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}）
            </span>
          )}
          {geo && (
            <Button variant="quiet" onClick={() => service.setFieldValue(field.key, undefined)}>
              去掉位置
            </Button>
          )}
        </div>
        {geo && (
          <Input
            aria-label="地点名"
            value={geo.place_name ?? ''}
            onChange={(e) => service.setFieldValue(field.key, { ...geo, place_name: e.target.value || undefined })}
            placeholder="给这个位置起个名（可选）"
          />
        )}
      </div>
    );
  }

  if (field.type === 'number-unit') {
    const nu = value as { value?: number; unit?: string } | undefined;
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${field.label}数值`}
          type="number"
          value={nu?.value === undefined ? '' : String(nu.value)}
          onChange={(e) => {
            const num = e.target.value === '' ? undefined : Number(e.target.value);
            const unit = nu?.unit ?? field.options?.[0] ?? '';
            service.setFieldValue(field.key, num === undefined ? undefined : { value: num, unit });
          }}
          placeholder="数值"
        />
        <Input
          aria-label={`${field.label}单位`}
          value={nu?.unit ?? field.options?.[0] ?? ''}
          onChange={(e) =>
            // 先填单位会产生 {value:0, unit} 半成品（评审 S6）：value 缺省置 0 由 server 校验兜底拒收，
            // web 不做跨字段校验（spec §1.2：复杂校验在 server 业务层）
            service.setFieldValue(field.key, { value: nu?.value ?? 0, unit: e.target.value })
          }
          placeholder="单位"
          className="w-24"
        />
      </div>
    );
  }

  if (field.type === 'date') {
    return (
      <Input
        aria-label={field.label}
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => service.setFieldValue(field.key, e.target.value || undefined)}
      />
    );
  }

  // text
  return (
    <Input
      aria-label={field.label}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => service.setFieldValue(field.key, e.target.value || undefined)}
    />
  );
});

/** kind payload 表单：渲染 payloadSchema 受限子集（object properties；enum→chips，number→数字，其余 string→文本）。 */
const KindPayloadForm = observer(function KindPayloadForm({
  service,
  manifest,
  kindKey,
}: {
  service: ComposePanelService;
  manifest: TemplateManifest;
  kindKey: string;
}) {
  const kindDef = (manifest.kinds ?? []).find((k) => k.key === kindKey);
  if (!kindDef) return null;
  const schema = kindDef.payloadSchema as {
    properties?: Record<string, { type?: string; enum?: string[]; pattern?: string; maxLength?: number }>;
  };
  const props = schema.properties ?? {};
  const catalog = manifest.milestoneCatalog ?? [];

  return (
    <div className="flex flex-col gap-3">
      {'catalog_key' in props && catalog.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="里程碑">
          {catalog.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={service.payloadDraft.catalog_key === c.key}
              onClick={() =>
                service.setFieldValue('catalog_key', service.payloadDraft.catalog_key === c.key ? undefined : c.key)
              }
              className={`${CHIP_BASE} ${service.payloadDraft.catalog_key === c.key ? CHIP_ON : CHIP_OFF}`}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      )}
      {Object.entries(props).map(([key, prop]) => {
        if (key === 'catalog_key' && catalog.length > 0) return null; // 已由目录 chips 承担
        const value = service.payloadDraft[key];
        if (prop.enum) {
          return (
            <div key={key} className="flex flex-wrap items-center gap-2" role="group" aria-label={key}>
              {prop.enum.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={value === opt}
                  onClick={() => service.setFieldValue(key, value === opt ? undefined : opt)}
                  className={`${CHIP_BASE} ${value === opt ? CHIP_ON : CHIP_OFF}`}
                >
                  {ENUM_LABELS[opt] ?? opt}
                </button>
              ))}
            </div>
          );
        }
        if (prop.type === 'number') {
          return (
            <Input
              key={key}
              aria-label={key}
              type="number"
              value={typeof value === 'number' ? String(value) : ''}
              onChange={(e) =>
                service.setFieldValue(key, e.target.value === '' ? undefined : Number(e.target.value))
              }
              placeholder={key === 'value' ? '数值' : key}
            />
          );
        }
        return (
          <Input
            key={key}
            aria-label={key}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => service.setFieldValue(key, e.target.value || undefined)}
            placeholder={key === 'custom_label' ? '自定义里程碑（或从上面选）' : key === 'note' ? '随手记一句（可选）' : key}
          />
        );
      })}
    </div>
  );
});

/** 发布面板的模板扩展区：kinds 入口（publisher.label）+ 当前 kind 表单 / standard 的 momentFields。 */
export const TemplateFields = observer(function TemplateFields({
  service,
  edit,
}: {
  service: ComposePanelService;
  edit: boolean;
}) {
  const manifest = service.manifest;
  if (!manifest) return null;
  const kinds = manifest.kinds ?? [];
  const fields = manifest.momentFields ?? [];
  if (kinds.length === 0 && fields.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {!edit && kinds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {kinds.map((k) => (
            <Button
              key={k.key}
              variant={service.kind === k.key ? 'primary' : 'secondary'}
              onClick={() => service.setKind(service.kind === k.key ? 'standard' : k.key)}
            >
              {k.publisher?.label ?? k.label}
            </Button>
          ))}
        </div>
      )}
      {service.kind !== 'standard' ? (
        <KindPayloadForm service={service} manifest={manifest} kindKey={service.kind} />
      ) : (
        fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <MomentFieldControl service={service} field={f} />
          </Field>
        ))
      )}
    </div>
  );
});
```

- [ ] **Step 3: 发布面板接入**

Modify `apps/web/src/compose/compose-panel/index.tsx`：
- import 区加 `import { TemplateFields } from '@/compose/template-fields';`。
- 多链选择器按钮（`{writable.map((c) => (` 块内）的 `onClick={() => (service.pickedChainId = c.id)}` 改为 `onClick={() => service.pickChain(c.id)}`（切链重置结构化状态，H4）。
- `useEffect(() => { void service.loadTagList(); }, [service, service.chainId]);` 下方加：
  ```tsx
  useEffect(() => {
    if (chainId) void service.loadManifest(chainId).catch(() => undefined); // 失败静默（service 注释）
  }, [service, chainId]);
  ```
- `<DateTimeField ... />` 块之后插入：
  ```tsx
  <TemplateFields service={service} edit={Boolean(edit)} />
  ```
- 编辑模式的 dirty 判定 `isDirty`（评审 S3——锚点用现状真实代码）：把现状的
  ```tsx
    return service.selectedTags.some((id) => !base.tagIds.includes(id));
  ```
  改为：
  ```tsx
    if (service.selectedTags.some((id) => !base.tagIds.includes(id))) return true;
    // 结构化字段草稿相对水合基线（编辑模式的既有 payload）有变化也算 dirty
    return JSON.stringify(service.payloadDraft) !== JSON.stringify(edit?.payload ?? {});
  ```

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```
Expected: 均 exit 0（既有测试无回归）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/compose/template-fields.tsx apps/web/src/compose/compose-panel/
git commit -m "feat(web): render template fields in composer from manifest"
```

---

### Task 5: 链主页聚合视图（tabs + curve/milestone-axis/moodline/trips 分章）+ 时刻卡模板呈现

**Files:**
- Create: `apps/web/src/chain/aggregate-views.tsx`（curve/milestone-axis/moodline/trips 四视图组件）
- Modify: `apps/web/src/pages/chain-home/chain-home.service.ts`
- Modify: `apps/web/src/pages/chain-home/index.tsx`
- Modify: `apps/web/src/timeline/timeline.tsx`、`apps/web/src/timeline/moment-sheet.tsx`（模板呈现：里程碑 label、mood、geo 地名、年龄标注）
- Test: 无新增组件测试（纯函数已在 Task 3 测；chain-home.test.tsx 的 CHAIN 字面量已在 Task 2 Step 1 升级为 ChainDetailDto，本 Task 无需再动；门禁 + 手动验收）

**Interfaces:**
- Consumes: Task 1 的 `client.getAggregate`；Task 3 的 `babyAgeLabel` / `groupMomentsByTrips` / `resolveMilestoneLabel`；dto `AggregateResponse` / `ChainDetailDto` / `TemplateManifest`。
- Produces:
  - `ChainHomeService` 增 `activeView: string`（`'timeline'` / `'trips'` / 其他视图 type）、`aggregate: AggregateResponse | null`、`setActiveView(view: string): void`、`loadAggregate(): Promise<void>`
  - `<AggregateView view aggregate moments chainPayload hasMore isLoading error onRetry map?>` 组件族（curve/milestone-axis/moodline/trips 分章；map 槽 Task 6 注入；**加载/失败三态由本组件承担**——骨架 + Banner 重试，评审 H3）
  - **视图 id 约定（防 key 撞车）**：travel 的 `views` 同时含 `timeline`（groupBy trips）与 `map`，tab id 不能用裸 `v.type`——`timeline`+`groupBy:'trips'` 的 tab id 用 `'trips'`，主时间线固定 `'timeline'`，其余用 `v.type`
  - `MomentSheetContent` 增可选 prop `templateManifest?: TemplateManifest | null`、`ageLabel?: string`；`Timeline` 增对应透传 prop

- [ ] **Step 1: ChainHomeService 接入视图状态**

Modify `apps/web/src/pages/chain-home/chain-home.service.ts`：
- import 类型行改为 `import type { AggregateResponse, ChainDetailDto, MonthIndexEntry, MomentResponse, TagResponse } from '@moment/dto';`
- `chain: ChainDto | null = null;` 改为 `chain: ChainDetailDto | null = null;`（import 列表删 `ChainDto`）。
- 字段区（`tags` 行后）加：
  ```ts
  /** 当前聚合视图（'timeline' = 主时间线；其余为 manifest.views 声明的 type） */
  activeView = 'timeline';
  /** 当前视图的投影数据（timeline/trips 不用端点，为 null） */
  aggregate: AggregateResponse | null = null;
  ```
- `hydrate` 中 `this.moments = [];` 行后加：
  ```ts
    this.activeView = 'timeline';
    this.aggregate = null;
  ```
- 类末尾加：
  ```ts
  /** 切视图（链眉下 tab）。tab id 约定见 Produces：'timeline' 主时间线 / 'trips' 行程分章 / 其余为视图 type。 */
  setActiveView(view: string): void {
    this.activeView = view;
    this.aggregate = null;
    if (view !== 'timeline' && view !== 'trips') void this.loadAggregate().catch(() => undefined);
  }

  async loadAggregate(): Promise<void> {
    const manifest = this.chain?.templateManifest;
    const viewDef = (manifest?.views ?? []).find((v) => v.type === this.activeView);
    if (!this.chainId || !viewDef) return;
    if (viewDef.type === 'timeline') return; // groupBy 分章走已加载 moments，不打端点
    this.aggregate = await client.getAggregate(this.chainId, {
      view: viewDef.type,
      kind: viewDef.source?.kind,
      field: viewDef.source?.field,
    });
  }
  ```
- 构造函数 `moment:changed` 监听内 `void this.loadMeta();` 后加 `if (this.activeView !== 'timeline' && this.activeView !== 'trips') void this.loadAggregate().catch(() => undefined);`（新记录后刷新当前视图）。

- [ ] **Step 2: 聚合视图组件**

Create `apps/web/src/chain/aggregate-views.tsx`：
```tsx
import type { ReactNode } from 'react';
import type { AggregateResponse, MomentResponse } from '@moment/dto';
import { METRIC_LABELS, groupMomentsByTrips, type Trip } from '@/lib/template';
import { formatHappenedClock } from '@/lib/time';
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
          <span aria-hidden className="text-body">{item.icon ?? '·'}</span>
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
          <span aria-label={`心情 ${d.mood}，${d.count} 次`}>
            {Array.from({ length: Math.min(d.count, 10) }, (_, i) => (
              <span key={i}>{d.mood}</span>
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
function TripsView({ moments, chainPayload, hasMore }: { moments: MomentResponse[]; chainPayload: Record<string, unknown> | null; hasMore: boolean }) {
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
  moments: MomentResponse[];
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
```

- [ ] **Step 3: 时刻卡模板呈现（milestone/mood/geo/年龄）**

Modify `apps/web/src/timeline/moment-sheet.tsx`：
- import 区加：
  ```tsx
  import type { TemplateManifest } from '@moment/dto';
  import { resolveMilestoneLabel } from '@/lib/template';
  ```
- `MomentSheetContent` props 类型加两个可选字段：
  ```tsx
  templateManifest?: TemplateManifest | null;
  /** baby 年龄标注（「1 岁 2 个月」）；由调用方按链 payload.birthdate 计算 */
  ageLabel?: string;
  ```
  解构处同步加 `templateManifest, ageLabel`。
- header 的 `{moment.isBackfill && ...}` 行后加（年龄标注紧跟时间，spec §4 展示层能力）：
  ```tsx
  {ageLabel && <span className="text-muted">{ageLabel}</span>}
  ```
- `{acts}` 之前插入模板呈现块（正文/媒体之下、互动条之上）。**判重（评审 H1）**：Task 4 对无正文 kind moment 用 `summarizePayload` 兜底填了 content（不含 icon 前缀），此处用**同一个函数**产出判重基准，`content.trim() === summaryText` 时跳过摘要行，避免与正文逐字重复；展示行再补 icon：
  ```tsx
  {moment.kind !== 'standard' && templateManifest && (() => {
    const p = moment.payload ?? {};
    // 与 Task 4 兜底同一函数：判重基准与兜底 content 逐字同源，不会出现「判定不一致导致重复显示」
    const summaryText = summarizePayload(templateManifest, moment.kind, p);
    if (!summaryText || moment.content.trim() === summaryText) return null; // H1 判重
    const { icon } = resolveMilestoneLabel(templateManifest, p); // metric 无 catalog_key → icon 恒 null
    return <p className="mt-1 text-meta text-muted">{icon ? `${icon} ${summaryText}` : summaryText}</p>;
  })()}
  {moment.kind === 'standard' && typeof moment.payload?.mood === 'string' && (
    <span className="mt-1 inline-block text-body" aria-label="心情">{moment.payload.mood}</span>
  )}
  {(() => {
    const geo = moment.payload?.geo as { place_name?: string } | undefined;
    return geo?.place_name ? <p className="mt-1 text-meta text-muted">📍 {geo.place_name}</p> : null;
  })()}
  ```
  import 区加一行（评审 S4：只此一条最终态 import 指令）：`import { resolveMilestoneLabel, summarizePayload } from '@/lib/template';`

  > 已知限制（v1 接受）：feed 首页（多链聚合）的 Timeline 不传 `templateManifest`/`ageLabelOf`，kind moment 的里程碑/数值摘要在 feed 里不显示，进链主页或详情可见；mood 与 geo 地名的展示不依赖 manifest，feed 里正常显示。

Modify `apps/web/src/timeline/timeline.tsx`：
- props 类型加：
  ```tsx
  templateManifest?: TemplateManifest | null;
  /** 年龄标注函数（chain-home 按链 payload.birthdate 提供；feed/分享页不传则不显示） */
  ageLabelOf?: (m: MomentResponse) => string;
  ```
  解构加 `templateManifest, ageLabelOf`；import 加 `import type { TemplateManifest } from '@moment/dto';`。
- `renderSheet` 内 `<MomentSheet ... />` 加两个透传：
  ```tsx
        templateManifest={templateManifest}
        ageLabel={ageLabelOf?.(m)}
  ```

- [ ] **Step 4: 链主页接入视图 tabs**

Modify `apps/web/src/pages/chain-home/index.tsx`：
- import 区加：
  ```tsx
  import { AggregateView } from '@/chain/aggregate-views';
  import { babyAgeLabel } from '@/lib/template';
  ```
- `</header>` 之后、`<TimelineRail` 之前插入视图 tabs（仅当模板声明了非 timeline 视图或有分章 timeline；tab id 约定：主时间线 `'timeline'`，timeline+groupBy 用 `'trips'`，其余用 `v.type`）：
  ```tsx
  {(() => {
    const views = chain.templateManifest.views ?? [];
    if (views.length === 0) return null;
    // 主时间线 tab 恒在首位；groupBy 的 timeline 视图 id 映射为 'trips'（防与主时间线撞 key）
    const tabs = [
      { id: 'timeline', label: '时间线' },
      ...views
        .filter((v) => v.type !== 'timeline' || v.groupBy === 'trips')
        .map((v) => ({ id: v.type === 'timeline' ? 'trips' : v.type, label: v.label })),
    ];
    return (
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="链视图">
        {tabs.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={service.activeView === v.id}
            onClick={() => service.setActiveView(v.id)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus ${
              service.activeView === v.id
                ? 'bg-select text-select-fg'
                : 'text-muted hover:bg-floating-hover hover:text-ink'
            }`}
          >
            {v.label}
          </button>
        ))}
      </nav>
    );
  })()}
  ```
- 主内容区：既有 `<Timeline ... />` 整段外包一层视图切换——`activeView === 'timeline'` 走原时间线（props 原样保留并加两个透传），其余 id 渲染 `<AggregateView>`：
  ```tsx
  {service.activeView === 'timeline' ? (
    <Timeline
      moments={service.moments}
      hideSignature={service.filter.order === 'created_at'}
      isPending={service.$model.loadFirst.loading}
      isError={Boolean(service.$model.loadFirst.error)}
      onRetry={() => void service.loadFirst()}
      hasNextPage={service.hasMore}
      isFetchingNextPage={service.$model.loadMore.loading}
      fetchNextPage={() => void service.loadMore()}
      templateManifest={chain.templateManifest}
      ageLabelOf={(m) => {
        const birthdate = chain.payload?.birthdate;
        return typeof birthdate === 'string' ? babyAgeLabel(birthdate, m.happenedAt, m.happenedTzOffset) : '';
      }}
      entry={canCompose(chain) ? <ComposerEntry chainId={chain.id} /> : undefined}
      empty={/* 既有 empty 分支原样保留 */}
    />
  ) : (
    <AggregateView
      view={service.activeView}
      aggregate={service.aggregate}
      moments={service.moments}
      chainPayload={chain.payload}
      hasMore={service.hasMore}
      isLoading={service.$model.loadAggregate.loading}
      error={service.$model.loadAggregate.error ? humanError(service.$model.loadAggregate.error) : null}
      onRetry={() => void service.loadAggregate().catch(() => undefined)} // 错误读 $model.loadAggregate.error，不双写
    />
  )}
  ```
  import 区加 `import { humanError } from '@/lib/errors';`（该文件既有 import 未含 humanError，需新增）。
  （`empty` 分支原样保留既有代码，不重复抄写——实现时保留现状整段。）

- [ ] **Step 5: 运行确认通过**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```
Expected: 均 exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/chain/aggregate-views.tsx apps/web/src/pages/chain-home/ apps/web/src/timeline/
git commit -m "feat(web): add aggregate view tabs and template moment rendering"
```

---

### Task 6: 地图视图（Leaflet）+ 分享只读页模板视图

**Files:**
- Create: `apps/web/src/chain/map-view.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`（AggregateView 注入 map）
- Modify: `apps/web/src/pages/share-album/share-album.service.ts`、`apps/web/src/pages/share-album/index.tsx`
- Test: 无（地图手动验收；门禁 typecheck/lint/build/test）

**Interfaces:**
- Consumes: Task 1 的 leaflet 依赖与 `VITE_MAP_TILE_URL`；Task 5 的 `AggregateView`（map 注入槽）；P3 的 `PublicShareResponse.aggregates` / `templateManifest` / `template`。
- Produces:
  - `<MapView aggregate>`（leaflet CircleMarker 点图；默认中心取首点，缩放 4）
  - `ShareAlbumService` 增 `templateManifest: TemplateManifest | null`、`aggregates: AggregateResponse[]`（响应的 template key 不落字段，无消费者——评审 S10）；分享页主时间线上方渲染只读视图区（map/milestone-axis/moodline/curve，无 tabs——长辈场景全量平铺）

- [ ] **Step 1: 地图视图组件**

Create `apps/web/src/chain/map-view.tsx`：
```tsx
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import type { AggregateResponse } from '@moment/dto';
import { formatHappenedClock } from '@/lib/time';
import { EmptyState } from '@/ui/feedback/index';

// 足迹地图（travel 模板）：leaflet + 栅格 tile。tile URL 走 VITE_MAP_TILE_URL，
// 缺省 OSM 公共 tile（自建/商用 tile 通过环境变量切换，见 .env.example）。
// 用 CircleMarker 不用默认 Marker——leaflet 默认图标资源在 Vite 下 404。

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function MapView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) {
  if (aggregate.points.length === 0) {
    return <EmptyState variant="plain" scope="section" title="还没有足迹" description="发时刻时添加位置，足迹会一个个落在这张地图上。" />;
  }
  const first = aggregate.points[0]!;
  return (
    <div className="overflow-hidden rounded-surface-md border border-line">
      {/* h-80 是组件视口尺寸（同 MediaBlock 的 max-h-40 先例），非布局间距，不受 4–32 档位约束 */}
      <MapContainer center={[first.lat, first.lng]} zoom={4} scrollWheelZoom className="h-80 w-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {aggregate.points.map((p) => (
          <CircleMarker
            key={p.momentId}
            center={[p.lat, p.lng]}
            radius={8}
            pathOptions={{ color: 'var(--action)', fillColor: 'var(--action)', fillOpacity: 0.7 }}
          >
            <Popup>
              {p.placeName && <strong>{p.placeName}<br /></strong>}
              {formatHappenedClock(p.happenedAt, new Date().getTimezoneOffset())}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
```

Modify `apps/web/src/pages/chain-home/index.tsx`——import 加 `import { MapView } from '@/chain/map-view';`；`<AggregateView ... />` 调用加 prop：
```tsx
      map={(props) => <MapView {...props} />}
```

- [ ] **Step 2: 分享页接入**

Modify `apps/web/src/pages/share-album/share-album.service.ts`：
- import 类型行改为 `import type { AggregateResponse, MomentResponse, TemplateManifest } from '@moment/dto';`
- 字段区（`nextCursor` 行后）加：
  ```ts
  /** 模板 manifest 与聚合投影（spec §3.2：分享响应附带，长辈可见里程碑轴/地图/心情线）。
   *  响应里的 template key 不落字段——当前无 UI 消费者（评审 S10），需要调试时从 templateManifest 推断。 */
  templateManifest: TemplateManifest | null = null;
  aggregates: AggregateResponse[] = [];
  ```
- `hydrate` 中 `this.moments = [];` 后加：
  ```ts
    this.templateManifest = null;
    this.aggregates = [];
  ```
- `loadFirst` 中 `this.chain = page.chain;` 后加：
  ```ts
    this.templateManifest = page.templateManifest;
    this.aggregates = page.aggregates;
  ```

Modify `apps/web/src/pages/share-album/index.tsx`：
- import 区加：
  ```tsx
  import { AggregateView } from '@/chain/aggregate-views';
  import { MapView } from '@/chain/map-view';
  ```
- `<main ...>` 内 `<Timeline ... />` 之前插入只读视图区（无 tabs，全量平铺——长辈场景少一层交互；timeline 视图除外，主时间线本身就是）。注意先把 `service.templateManifest` 提到局部 const——TS 对可变属性访问的 null 收窄不会流入嵌套回调：
  ```tsx
  {(() => {
    const manifest = service.templateManifest;
    if (!manifest || service.aggregates.length === 0) return null;
    return (
      <div className="mb-8 flex flex-col gap-6">
        {service.aggregates.map((agg) => (
          <section key={agg.view}>
            <h2 className="mb-2 text-body font-semibold text-ink">
              {(manifest.views ?? []).find((v) => v.type === agg.view)?.label ?? agg.view}
            </h2>
            <AggregateView
              view={agg.view}
              aggregate={agg}
              moments={service.moments}
              chainPayload={null}
              hasMore={false}
              isLoading={false}
              error={null}
              onRetry={() => void service.loadFirst()}
              map={(props) => <MapView {...props} />}
            />
          </section>
        ))}
      </div>
    );
  })()}
  ```

- [ ] **Step 3: 运行确认通过**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web test && pnpm --filter @moment/web build
```
Expected: 均 exit 0；`vite build` 产物含 leaflet css 分包。

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/chain/map-view.tsx apps/web/src/pages/chain-home/index.tsx apps/web/src/pages/share-album/
git commit -m "feat(web): add footprint map and share-page template views"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/web test` 全绿（既有 + 新增 lib/template 6 个 it），`typecheck` / `lint` / `build` 均 exit 0
- [ ] P3 中间态消除：web 全仓 typecheck 不再因 `createChain` 缺 template / `getChain` 类型而报错
- [ ] 词表纪律自查：`grep -rn "=== 'baby'\|=== 'travel'\|=== 'daily'" apps/web/src` 无命中（模板 key 不出现在渲染分支里）
- [ ] **已知限制声明（评审 H2/S 系列裁决）**：TripsView 只统计已加载的分页 moments（视图内有「统计已加载的 N 条」注明）；feed 首页不显示里程碑/数值摘要（mood/geo 地名正常显示）；聚合投影不含 happenedTzOffset，里程碑轴/地图弹窗用查看者本地偏移展示
- [ ] **手动验收清单**（按 spec §5 与编排 T5）：
  1. 建 baby 链（选「宝宝成长」模板，对话框明示「模板选定后不可更改」）→ 发布面板出「记一个里程碑 / 记身高体重」入口 → 记里程碑（目录 chips 选「第一次微笑」）→ 时间线卡片显示 😊 第一次微笑 → 链主页「里程碑」tab 出轴 → 记身高体重 →「成长曲线」tab 出 SVG 双线。
  2. baby 链补录生日（链设置 payload 编辑属 P3 server 已支持；web 侧经 API 或后续链设置 UI——本轮手动验收用 API 补录）后，时间线卡片时间旁显示「N 岁 N 个月」。
  3. 建 travel 链 → 发时刻点「添加位置」（浏览器授权定位）→ 卡片显示 📍 地名 →「足迹地图」tab 出 leaflet 地图与点位 → 链 payload 配 trips 后「行程」tab 按行程分章。
  4. 建 daily 链 → 发时刻选心情 😄 → 卡片显示心情 →「心情曲线」tab 出按日分布。
  5. 编辑一条 milestone moment：不切换 kind，改 note 保存成功（S4：payload 显式携带）；编辑 standard moment 把心情从 😄 改 😭 再清空，均保存成功。
  6. baby 链开分享链接 → 无痕窗口打开 → 里程碑轴只读可见；travel 链分享页见地图；daily 链分享页见心情线。
  7. 定位权限拒绝时发布面板显示人话错误（「没拿到定位…」），不崩溃、不留半成品草稿。
- [ ] 执行 prompt T5 Produces 逐个可解析：模板卡片选择器 / 词表发布器渲染器 / 聚合视图渲染器 / 分享页只读视图 / `VITE_MAP_TILE_URL`
