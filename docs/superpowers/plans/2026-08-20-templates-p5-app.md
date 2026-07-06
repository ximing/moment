# 链模板系统 P5：app 模板感知 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** app（Expo RN）端接入链模板系统：创建链选模板、发布面板按 manifest 动态渲染扩展字段与结构化记录、链主页聚合视图（曲线/里程碑轴/心情线/行程分章/地图）、时刻卡模板呈现。

**Architecture:** 与 P4（web）同一套产品行为、同一批上游契约，组件实现按 RN 重写。全部模板感知 UI 由 manifest 驱动（词表通用渲染器，禁止按模板 key 硬编码）；聚合数据走 P3 的 `GET /api/chains/:chainId/aggregate`；timeline 分章不走端点，用已加载 moments + 链 payload.trips 前端分组。地图用 react-native-maps，曲线用 react-native-svg 手绘，不引重型图表库。

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19 / @rabjs/react（Service 模式）/ @moment/api-client / expo-location + react-native-maps + react-native-svg（本计划新增依赖）。

**Spec:** `docs/superpowers/specs/2026-08-20-chain-templates-design.md`（§1.3 manifest DSL、§4 三模板、§5 各端 UX）

## Global Constraints

- 执行 prompt T6 契约：`docs/superpowers/prompts/2026-08-20-chain-templates-execution.md`。
- 上游契约（已评审通过）：dto 的 `TemplateManifest` / `TemplateMomentField` / `TemplateDto` / `AggregateResponse` / `AggregateQuery` / `ChainDetailDto`（P1+P3）；api-client 的 `listTemplates` / `getAggregate` / `getChain(): Promise<ChainDetailDto>`（P4 Task 1 已落地，app 经 `src/lib/api.ts` 的 `client` 直接消费，**本计划不动 api-client**）。
- **词表渲染器纪律（spec §5）**：禁止 `template === 'baby'` 这类按模板 key 的分支；允许的数据驱动特例：`chain.payload?.birthdate` 存在即显示年龄标注。
- **继承 P4 已裁决口径（不重新发明）**：
  1. kind moment 正文兜底：text 类型 content 必填，kind ≠ standard 且正文空时用 `summarizePayload` 摘要兜底填入 content，server 契约不变；摘要为空且只有结构化内容时前置人话提示「选一项或写一句，再发布」（P4 S8，文案与 app 发布按钮对齐）。
  2. S4：编辑模式不允许切换 kind；提交编辑时始终显式携带原 `kind` + 编辑后的 `payload`（无扩展值时显式 `null`）。
  3. 切链重置（P4 H4）：compose 内切换链时重置 `kind='standard'` + 清空 `payloadDraft` + manifest 置 null 重载。
  4. 聚合视图三态（P4 H3）：loading / error（可重试）/ 空数据三态由视图组件承担。
  5. trips 分章只统计已加载 moments（P4 H2）：视图内注明统计范围。
  6. 视图 tab id 约定（P4）：主时间线 `'timeline'`，timeline+groupBy:'trips' 用 `'trips'`，其余用 `v.type`。
  7. 聚合投影不含 happenedTzOffset：里程碑轴/地图弹窗的时间展示用查看者本地偏移（家庭同时区场景无差，代码注释声明）。
  8. feed 首页已知限制：不传 manifest，里程碑/数值摘要在 feed 不显示（mood/geo 地名不依赖 manifest，正常显示）；app 侧 moment 详情页同样不传（v1 接受）。
  9. 链设置 payload 编辑 UI（补录生日/行程）不进本轮（P4 决策 9）：手动验收用 API 补录验证。
- **app 端硬约束（apps/app/CLAUDE.md）**：新代码消费 `useTheme()`；**禁 hex/rgba 字面量**（`lint:tokens` 门禁，唯一豁免 `src/theme/tokens.ts`——地图/曲线的颜色一律从 theme 取）；间距只用 `space1..space8`、字号只用 `fontCaption..fontInput`、命中区 ≥ `touchMin`；按钮一律走 `src/components/Button.tsx`；rab 纪律（bindServices/observer、禁解构 observable、跨域刷新只走 `'global'` 事件）；app 包**无测试基建**（无 vitest），门禁 = `typecheck` + `lint` + 手动验收（CONVENTIONS §4），本计划不新增测试框架。
- **app 无分享页**：分享链接落 web 公开页（`src/lib/api.ts` 的 `webUrl` 注释即此约定），分享只读视图已在 P4 覆盖，本计划无对应 Task。
- 每 Task 一个 commit（conventional commits `feat(app): ...`）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

---

### Task 1: 依赖与 Expo 配置（expo-location / react-native-maps / react-native-svg）+ 中间态基线核对

**Files:**
- Modify: `apps/app/package.json`（经 expo install 加三个依赖）、`apps/app/app.config.ts`（expo-location 插件 + 定位用途文案）
- Test: 无（app 无测试基建，CONVENTIONS §4）

**Interfaces:**
- Consumes: Expo SDK 54 现状（`apps/app/package.json`、`app.config.ts` 的 plugins 数组）。
- Produces: `expo-location` / `react-native-maps` / `react-native-svg` 三个依赖（SDK 54 兼容版本，由 expo install 选定）；iOS 定位权限用途文案。

- [ ] **Step 1: 加依赖（expo install 自动选 SDK 兼容版本，不手写版本号）**

Run:
```bash
pnpm --filter @moment/app exec expo install expo-location react-native-maps react-native-svg
```
Expected: exit 0；`apps/app/package.json` dependencies 增 `expo-location` / `react-native-maps` / `react-native-svg`。三者均包含在 Expo Go 中，开发期不需要额外 dev build；EAS 构建走 autolinking，无需 config plugin（react-native-maps 的 Android Google Maps key 属发布配置，见本计划 DoD 风险声明）。

**版本纪律（评审裁决）**：react-native-maps 只能经 `expo install` 装 SDK 捆绑版（SDK 54 捆绑 1.20.1，Expo Go 内置即此版）；**禁止手工指定/升级版本**——新版 native 模块与 Expo Go 内置不一致会崩 `RNMapsAirModule`。

- [ ] **Step 2: app.config.ts 加定位插件**

Modify `apps/app/app.config.ts`——`plugins` 数组改为：
```ts
  plugins: [
    'expo-router',
    'expo-secure-store',
    // 旅行模板「添加位置」的 iOS 权限用途文案（提交 App Store 必需；Android 由插件自动补权限声明）
    ['expo-location', { locationWhenInUseUsageDescription: '记录时刻时附上当前位置，生成旅行足迹地图' }],
  ],
```

- [ ] **Step 3: 运行确认（typecheck 基线核对，非全绿——P3 中间态由 Task 2 收口）**

Run:
```bash
pnpm --filter @moment/app lint
pnpm --filter @moment/app typecheck
```
Expected: lint exit 0；typecheck **预期非零，但有且只有 1 处报错**：`src/features/chains-new/chains-new.service.ts` 的 `client.createChain({...})` 入参缺 `template`（P3 起 dto 必填；Task 2 Step 1 修复）。出现第二处 typecheck 报错即停手报告（已穷尽核实：app 全仓无 `MomentResponse`/`ChainDto` 字面量构造、无测试文件，`createChain` 调用点仅 chains-new 一处）。
另知悉 1 处 **runtime 校验失败**（不进 typecheck）：`src/features/chains-new/index.tsx` 的 `createChainInputSchema.safeParse({...})` 缺 `template`——safeParse 入参类型是 `unknown`，编译期不拦，P3 后提交会在运行时被 zod 拒并弹 Alert；Task 2 Step 2 一并修复。

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/package.json apps/app/app.config.ts pnpm-lock.yaml
git commit -m "feat(app): add location maps and svg deps for template views"
```

---

### Task 2: 创建链选模板（修复 P3 中间态）

**Files:**
- Modify: `apps/app/src/features/chains-new/chains-new.service.ts`
- Modify: `apps/app/src/features/chains-new/index.tsx`
- Test: 无

**Interfaces:**
- Consumes: `client.listTemplates`（P4 Task 1）；dto `TemplateDto` / `createChainInputSchema`；既有 `Screen`/`Field`/`Button` 组件。
- Produces: `ChainsNewService.templates: TemplateDto[]`、`.template: string`（默认 `'daily'`）、`.loadTemplates(): Promise<void>`；创建提交体含 `template`（本 Task 修复 app 侧中间态）。

- [ ] **Step 1: 改 service**

Modify `apps/app/src/features/chains-new/chains-new.service.ts`，全量替换为：
```ts
import { Service } from '@rabjs/react';
import type { TemplateDto } from '@moment/dto';
import { client } from '../../lib/api';

/** 新建链：模板选择 + 表单 + createChain；schema 校验（Alert）留在组件。 */
export class ChainsNewService extends Service {
  name = '';
  description = '';
  /** 官方模板候选（scope=official）；进入页面时加载 */
  templates: TemplateDto[] = [];
  /** 选中的模板 key（spec §0：创建时选定不可改）；默认日常生活 */
  template = 'daily';

  /** 进入页面时调用：拉官方模板（失败静默——选择器不渲染，仍可建 daily 链） */
  async loadTemplates(): Promise<void> {
    this.templates = await client.listTemplates('official');
  }

  async submit(): Promise<void> {
    const c = await client.createChain({
      name: this.name,
      description: this.description || null,
      visibility: 'private',
      template: this.template,
    });
    this.emit('chain:changed', { chainId: c.id, op: 'create' }, 'global');
  }
}
```

- [ ] **Step 2: 改页面 UI（模板卡片选择器，数据驱动不写死模板）**

Modify `apps/app/src/features/chains-new/index.tsx`：
- import 区 `import { useMemo } from 'react';` 改为 `import { useEffect, useMemo } from 'react';`；`import { Alert, StyleSheet, Text } from 'react-native';` 改为 `import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';`
- `Content` 内 `const styles = useMemo(...)` 行后加：
  ```tsx
  useEffect(() => {
    void service.loadTemplates().catch(() => undefined); // 失败静默：选择器不渲染，默认 daily
  }, []);
  ```
- `onSubmit` 的 `safeParse` 入参加 `template: service.template,`（`visibility` 行后）。
- `<Field label="名称（1–100 字）" ... />` 之前插入模板选择器（词表驱动：数据全部来自 `service.templates`）：
  ```tsx
  {service.templates.length > 0 ? (
    <View style={styles.tplSection}>
      <Text style={styles.tplLabel}>这条链记什么</Text>
      <Text style={styles.tplHint}>模板选定后不可更改</Text>
      {service.templates.map((tpl) => (
        <Pressable
          key={tpl.key}
          accessibilityRole="button"
          accessibilityState={{ selected: service.template === tpl.key }}
          style={[styles.tplCard, service.template === tpl.key && styles.tplCardActive]}
          onPress={() => (service.template = tpl.key)}
        >
          <Text style={styles.tplName}>
            {tpl.icon} {tpl.name}
          </Text>
          {tpl.description ? <Text style={styles.tplDesc}>{tpl.description}</Text> : null}
        </Pressable>
      ))}
    </View>
  ) : null}
  ```
- `createStyles` 的 StyleSheet.create 对象内追加（全部走 token，禁 hex/rgba）：
  ```ts
    tplSection: { gap: t.space2, marginBottom: t.space3 },
    tplLabel: { fontSize: t.fontLabel, color: t.ink, fontWeight: '600' },
    tplHint: { fontSize: t.fontCaption, color: t.muted },
    tplCard: { backgroundColor: t.surface, borderRadius: t.radiusMd, borderWidth: 2, borderColor: t.line, padding: t.space3, gap: t.space1, minHeight: t.touchMin },
    tplCardActive: { borderColor: t.action },
    tplName: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    tplDesc: { fontSize: t.fontSupport, color: t.muted },
  ```

- [ ] **Step 3: 运行确认通过**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0（含 lint:tokens 零命中）。**此 Task 后 P3 遗留的 app typecheck 中间态全部消除。**

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/chains-new/
git commit -m "feat(app): pick chain template on creation"
```

---

### Task 3: 模板纯函数库（年龄标注 / 行程分章 / payload 摘要）

**Files:**
- Create: `apps/app/src/lib/template.ts`
- Test: 无（app 无测试基建；函数与 P4 web 版逐字同口径，web 侧已有 6 个 vitest 用例覆盖同一逻辑——门禁 = typecheck + lint + DoD 手动验收）

**Interfaces:**
- Consumes: dto 的 `TemplateManifest` / `MomentResponse`。
- Produces（Task 4/5/6 消费，不得改名；与 P4 web `lib/template.ts` 同名同语义）:
  - `babyAgeLabel(birthdate: string, happenedAtIso: string, tzOffsetMinutes: number): string`
  - `interface Trip { name: string; start: string; end: string }`、`interface TripSection extends Trip { moments: MomentResponse[] }`、`groupMomentsByTrips(moments: MomentResponse[], trips: Trip[]): { sections: TripSection[]; outside: MomentResponse[] }`
  - `resolveMilestoneLabel(manifest: TemplateManifest, payload: Record<string, unknown>): { label: string; icon: string | null }`
  - `METRIC_LABELS: Record<string, string>`
  - `summarizePayload(manifest: TemplateManifest, kind: string, payload: Record<string, unknown> | null): string`

- [ ] **Step 1: 实现纯函数库**

Create `apps/app/src/lib/template.ts`：
```ts
import type { MomentResponse, TemplateManifest } from '@moment/dto';

// 模板相关的纯函数（纯逻辑下沉 lib，app CLAUDE.md 放置约束）。
// 与 web 端 lib/template.ts（P4 Task 3）同名同语义——展示层逻辑不进 dto 包
// （dto 是纯契约包），两端各持一份，口径以 P4 已测版本为准。
// 全部由 manifest/payload 数据驱动，不出现模板 key 硬编码（spec §5 词表渲染器纪律）。

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 发生地墙钟日 YYYY-MM-DD（shift 后取 UTC 字段才是提交者墙钟，同 lib/format.ts 的换算手法）。 */
function wallDateKey(iso: string, tzOffsetMinutes: number): string {
  const shifted = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * 宝宝年龄标注（spec §4：birthdate + happened_at 计算，不落库）。
 * 按发生地墙钟日算整月差：日不足向前借一月。未满 1 岁「N 个月」，否则「N 岁 M 个月」（M=0 只显示岁）。
 */
export function babyAgeLabel(birthdate: string, happenedAtIso: string, tzOffsetMinutes: number): string {
  const wall = wallDateKey(happenedAtIso, tzOffsetMinutes);
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

/** 行程定义（travel 模板链 payload.trips 的元素形状；与 dto chainPayloadSchema 对应）。 */
export interface Trip {
  name: string;
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD */
  end: string;
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
    const day = wallDateKey(m.happenedAt, m.happenedTzOffset);
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

/** metric 枚举值 → 中文摘要名（词表内已知值的展示文案；未知值用原文）。 */
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

- [ ] **Step 2: 运行确认通过**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0。

- [ ] **Step 3: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/lib/template.ts
git commit -m "feat(app): add template pure helpers for age trips and payload"
```

---

### Task 4: 发布面板词表渲染器（momentFields + kinds + 编辑模式 S4）

**Files:**
- Create: `apps/app/src/features/compose/template-fields.tsx`（词表字段渲染器组件）
- Modify: `apps/app/src/features/compose/compose.service.ts`
- Modify: `apps/app/src/features/compose/index.tsx`
- Test: 无（门禁 = typecheck/lint + DoD 手动验收）

**Interfaces:**
- Consumes: `client.getChain`（ChainDetailDto 内嵌 manifest）；Task 3 的 `summarizePayload`；dto `TemplateManifest` / `TemplateMomentField`；Task 1 的 expo-location。
- Produces:
  - `ComposeService` 增 `manifest: TemplateManifest | null`、`kind: string`（默认 `'standard'`）、`payloadDraft: Record<string, unknown>`、`geoBusy: boolean`、`loadManifest(chainId): Promise<void>`（防串链守卫可重试，见 Step 1）、`setKind(kind): void`、`setFieldValue(key, value): void`、`pickGeo(fieldKey): Promise<string | null>`（返回问题文案，null = 成功；组件侧照 compose/index.tsx onPickVideo 模式 Alert）；`setChain` 扩展为切链重置结构化状态（P4 H4）
  - `<TemplateFields service edit>` 组件：按 manifest 渲染 momentFields（emoji-picker/geo/enum/date/number-unit/text）与 kinds publisher 入口 + kind payload 表单
  - 提交体：创建时含 `kind` + `payload`（无扩展值则省略 payload）；编辑时始终显式 `kind`（原值，不可改）+ `payload`（S4）

- [ ] **Step 1: service 接入 manifest 与 kind/payload 草稿**

Modify `apps/app/src/features/compose/compose.service.ts`：
- import 区加：
  ```ts
  import * as Location from 'expo-location';
  import type { TemplateManifest } from '@moment/dto';
  import { summarizePayload } from '../../lib/template';
  ```
- 字段区（`tagNames` 行后）加：
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
- `hydrate` 方法 `this.chainId = chainId;` 行后加：
  ```ts
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
    // manifest 锚点用 activeChainId 而非原始路由参数（评审 B2）：含「回退第一条可编辑链」
    // 后的值——feed 首页 /compose 无 chainId、单链用户（无链 chips 可点）也要触发加载。
    // 此刻 ChainListService 可能未就绪（activeChainId undefined）→ 跳过，由组件 effect 重试（Step 3）
    const active = this.activeChainId;
    if (active) void this.loadManifest(active).catch(() => undefined);
  ```
- `loadForEdit` 方法 `this.isBackfill = m.isBackfill;` 行后加：
  ```ts
    // 编辑模式：kind 锁定原值，payload 草稿从既有值水合（S4：提交时 kind+payload 始终显式携带）
    this.kind = m.kind;
    this.payloadDraft = { ...(m.payload ?? {}) };
  ```
  并在 `await this.loadTags();` 行后加 `void this.loadManifest(m.chainId).catch(() => undefined);`
- `setChain` 方法改为（切链重置结构化状态，P4 H4——旧链的 kind/payload 草稿对新链模板无意义）：
  ```ts
  setChain(id: string): void {
    if (this.chainId === id) return;
    this.chainId = id;
    this.tagIds = [];
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
    void this.loadTags().catch(() => undefined);
    void this.loadManifest(id).catch(() => undefined);
  }
  ```
- `loadTags` 后加：
  ```ts
  /** 链切换时拉模板 manifest（链详情内嵌；同链幂等）。失败静默：无扩展字段可填，主流程不阻塞。 */
  async loadManifest(chainId: string): Promise<void> {
    if (!chainId || this.manifestChainId === chainId) return;
    this.manifestChainId = chainId;
    const detail = await client.getChain(chainId);
    // 防串链守卫且可重试（评审 B2）：仅当链仍匹配时落 manifest；不匹配
    // （含 ChainListService 未就绪、activeChainId 暂未命中该链）时清占位，
    // 允许组件 effect 在链列表就绪后重试——不静默丢弃、不占位锁死
    if (this.activeChainId === chainId) {
      this.manifest = detail.templateManifest;
    } else if (this.manifestChainId === chainId) {
      this.manifestChainId = '';
    }
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

  /** geo 字段：expo-location 前台定位；返回问题文案（null = 成功，草稿不留半成品）。
   *  权限拒绝/超时/不可用的人话文案与 P4 web 同口径。 */
  async pickGeo(fieldKey: string): Promise<string | null> {
    this.geoBusy = true;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return '没拿到定位权限，去系统设置里开一下';
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
      ]);
      const prev = this.payloadDraft[fieldKey] as { place_name?: string } | undefined;
      this.setFieldValue(fieldKey, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ...(prev?.place_name ? { place_name: prev.place_name } : {}),
      });
      return null;
    } catch {
      return '没拿到定位，检查一下定位服务是不是开着';
    } finally {
      this.geoBusy = false;
    }
  }
  ```
- `submit` 新建分支的前置校验 `if (this.type === 'text' && this.content.trim().length === 0) throw new Error('文字类型需要内容');` 改为：
  ```ts
    // kind moment 允许无正文（结构化字段即内容，正文由摘要兜底）；standard 维持原校验
    if (this.type === 'text' && this.content.trim().length === 0 && this.kind === 'standard') throw new Error('文字类型需要内容');
  ```
  并在该行后加（P4 S8：摘要也为空时不发空 content 给 server 被 400，前置人话提示）：
  ```ts
    if (this.kind !== 'standard' && this.content.trim().length === 0 && this.type === 'text') {
      const s = summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft);
      if (!s) throw new Error('选一项或写一句，再发布');
    }
  ```
- `submit` 新建分支的 `client.createMoment(activeChainId, {...})` 入参 `tagIds` 行后加：
  ```ts
        kind: this.kind,
        ...(Object.keys(this.payloadDraft).length > 0 ? { payload: this.payloadDraft } : {}),
  ```
  并把入参的 `content: this.content,` 改为（kind moment 正文兜底，Global Constraints 继承 P4）：
  ```ts
        content:
          this.content.trim().length === 0 && this.kind !== 'standard'
            ? summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft)
            : this.content,
  ```
- `submitEdit` 的 `const patch: PatchMomentInput = { content: this.content, tagIds: this.tagIds };` 改为（S4：kind 原值 + payload 始终显式）：
  ```ts
    const patch: PatchMomentInput = {
      content: this.content,
      tagIds: this.tagIds,
      kind: edit.kind,
      payload: Object.keys(this.payloadDraft).length > 0 ? this.payloadDraft : null,
    };
  ```
  同时 `submitEdit` 的前置校验 `if (edit.type === 'text' && this.content.trim().length === 0)` 改为：
  ```ts
    if (edit.type === 'text' && this.content.trim().length === 0 && edit.kind === 'standard') throw new Error('文字类型需要内容');
  ```

- [ ] **Step 2: 词表字段渲染器组件**

Create `apps/app/src/features/compose/template-fields.tsx`：
```tsx
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { observer } from '@rabjs/react';
import type { TemplateManifest, TemplateMomentField } from '@moment/dto';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { useTheme } from '../../theme/use-theme';
import type { ComposeService } from './compose.service';

// 词表通用渲染器（spec §5 硬纪律）：按 manifest 的 momentFields / kinds 声明渲染，
// 不出现模板 key 分支。kind 表单渲染 payloadSchema 的受限子集：
// enum → chips、number → 数字输入、其余 string → 文本输入；payloadSchema 有 catalog_key
// 且 manifest 带 milestoneCatalog 时渲染目录 chips。词表/schema 子集外的声明静默不渲染
// （server 是最终校验，app 只做录入辅助）。

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

function useChipStyles() {
  const t = useTheme();
  return useMemo(
    () =>
      // 尺寸全部上 token 档（H1：新文件不吃旧值的迁移平移豁免）；
      // 选中态对齐 SegmentBar：ink 色面 + bg 文字（primary 只留给发布/保存）
      StyleSheet.create({
        chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space2 },
        chip: { paddingHorizontal: t.space3, paddingVertical: t.space2, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft, minHeight: t.touchMin, justifyContent: 'center' as const },
        chipActive: { backgroundColor: t.ink },
        chipText: { fontSize: t.fontSupport, color: t.muted },
        chipTextActive: { color: t.bg, fontWeight: '600' as const },
        label: { fontSize: t.fontLabel, color: t.ink, marginBottom: t.space1 },
        geoText: { fontSize: t.fontSupport, color: t.muted },
        section: { gap: t.space2, marginBottom: t.space3 },
      }),
    [t],
  );
}

/** 单个 momentField 的词表渲染（emoji-picker/geo/enum/date/number-unit/text）。 */
const MomentFieldControl = observer(function MomentFieldControl({
  service,
  field,
}: {
  service: ComposeService;
  field: TemplateMomentField;
}) {
  const styles = useChipStyles();
  const value = service.payloadDraft[field.key];

  if (field.type === 'emoji-picker' || field.type === 'enum') {
    return (
      <View style={styles.chipRow} accessibilityLabel={field.label}>
        {(field.options ?? []).map((opt) => (
          <Pressable
            key={opt}
            style={[styles.chip, value === opt && styles.chipActive]}
            onPress={() => service.setFieldValue(field.key, value === opt ? undefined : opt)}
          >
            <Text style={[styles.chipText, value === opt && styles.chipTextActive]}>
              {field.type === 'emoji-picker' ? opt : (ENUM_LABELS[opt] ?? opt)}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  if (field.type === 'geo') {
    const geo = value as { lat: number; lng: number; place_name?: string } | undefined;
    return (
      <View style={styles.section}>
        <View style={styles.chipRow}>
          <Button
            variant="secondary"
            loading={service.geoBusy}
            // pickGeo 返回问题文案（null=成功），照 compose/index.tsx onPickVideo 模式接住并 Alert（评审 B1）
            onPress={() =>
              void service.pickGeo(field.key).then((problem) => {
                if (problem) Alert.alert('提示', problem);
              })
            }
          >
            {geo ? '重新定位' : field.label}
          </Button>
          {geo ? (
            <Button variant="quiet" onPress={() => service.setFieldValue(field.key, undefined)}>
              去掉位置
            </Button>
          ) : null}
        </View>
        {geo ? (
          <>
            <Text style={styles.geoText}>
              已添加位置（{geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}）
            </Text>
            <Field
              label="地点名（可选）"
              value={geo.place_name ?? ''}
              onChangeText={(v) => service.setFieldValue(field.key, { ...geo, place_name: v || undefined })}
              placeholder="给这个位置起个名"
            />
          </>
        ) : null}
      </View>
    );
  }

  if (field.type === 'number-unit') {
    const nu = value as { value?: number; unit?: string } | undefined;
    return (
      <View style={styles.section}>
        <Field
          label={`${field.label}数值`}
          keyboardType="numeric"
          value={nu?.value === undefined ? '' : String(nu.value)}
          onChangeText={(v) => {
            const num = v === '' ? undefined : Number(v);
            const unit = nu?.unit ?? field.options?.[0] ?? '';
            service.setFieldValue(field.key, num === undefined || Number.isNaN(num) ? undefined : { value: num, unit });
          }}
          placeholder="数值"
        />
        <Field
          label={`${field.label}单位`}
          value={nu?.unit ?? field.options?.[0] ?? ''}
          onChangeText={(v) =>
            // 先填单位会产生 {value:0, unit} 半成品（P4 S6 同口径）：server 校验兜底拒收，端上不做跨字段校验
            service.setFieldValue(field.key, { value: nu?.value ?? 0, unit: v })
          }
          placeholder="单位"
        />
      </View>
    );
  }

  if (field.type === 'date') {
    // 官方三模板暂不使用 date 词表；文本输入 YYYY-MM-DD，server 校验格式（简化取舍，报告声明）
    return (
      <Field
        label={field.label}
        value={typeof value === 'string' ? value : ''}
        onChangeText={(v) => service.setFieldValue(field.key, v || undefined)}
        placeholder="YYYY-MM-DD"
      />
    );
  }

  // text
  return (
    <Field
      label={field.label}
      value={typeof value === 'string' ? value : ''}
      onChangeText={(v) => service.setFieldValue(field.key, v || undefined)}
    />
  );
});

/** kind payload 表单：渲染 payloadSchema 受限子集（object properties；enum→chips，number→数字，其余 string→文本）。 */
const KindPayloadForm = observer(function KindPayloadForm({
  service,
  manifest,
  kindKey,
}: {
  service: ComposeService;
  manifest: TemplateManifest;
  kindKey: string;
}) {
  const styles = useChipStyles();
  const kindDef = (manifest.kinds ?? []).find((k) => k.key === kindKey);
  if (!kindDef) return null;
  const schema = kindDef.payloadSchema as {
    properties?: Record<string, { type?: string; enum?: string[] }>;
  };
  const props = schema.properties ?? {};
  const catalog = manifest.milestoneCatalog ?? [];

  return (
    <View style={styles.section}>
      {'catalog_key' in props && catalog.length > 0 ? (
        <View style={styles.chipRow} accessibilityLabel="里程碑">
          {catalog.map((c) => (
            <Pressable
              key={c.key}
              style={[styles.chip, service.payloadDraft.catalog_key === c.key && styles.chipActive]}
              onPress={() =>
                service.setFieldValue('catalog_key', service.payloadDraft.catalog_key === c.key ? undefined : c.key)
              }
            >
              <Text style={[styles.chipText, service.payloadDraft.catalog_key === c.key && styles.chipTextActive]}>
                {c.icon} {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {Object.entries(props).map(([key, prop]) => {
        if (key === 'catalog_key' && catalog.length > 0) return null; // 已由目录 chips 承担
        const value = service.payloadDraft[key];
        if (prop.enum) {
          return (
            <View key={key} style={styles.chipRow} accessibilityLabel={key}>
              {prop.enum.map((opt) => (
                <Pressable
                  key={opt}
                  style={[styles.chip, value === opt && styles.chipActive]}
                  onPress={() => service.setFieldValue(key, value === opt ? undefined : opt)}
                >
                  <Text style={[styles.chipText, value === opt && styles.chipTextActive]}>{ENUM_LABELS[opt] ?? opt}</Text>
                </Pressable>
              ))}
            </View>
          );
        }
        if (prop.type === 'number') {
          return (
            <Field
              key={key}
              label={key === 'value' ? '数值' : key}
              keyboardType="numeric"
              value={typeof value === 'number' ? String(value) : ''}
              onChangeText={(v) => {
                const num = v === '' ? undefined : Number(v);
                service.setFieldValue(key, num === undefined || Number.isNaN(num) ? undefined : num);
              }}
            />
          );
        }
        return (
          <Field
            key={key}
            label={key === 'custom_label' ? '自定义里程碑（或从上面选）' : key === 'note' ? '随手记一句（可选）' : key}
            value={typeof value === 'string' ? value : ''}
            onChangeText={(v) => service.setFieldValue(key, v || undefined)}
          />
        );
      })}
    </View>
  );
});

/** 发布面板的模板扩展区：kinds 入口（publisher.label）+ 当前 kind 表单 / standard 的 momentFields。 */
export const TemplateFields = observer(function TemplateFields({
  service,
  edit,
}: {
  service: ComposeService;
  edit: boolean;
}) {
  const styles = useChipStyles();
  const manifest = service.manifest;
  if (!manifest) return null;
  const kinds = manifest.kinds ?? [];
  const fields = manifest.momentFields ?? [];
  if (kinds.length === 0 && fields.length === 0) return null;

  return (
    <View style={styles.section}>
      {!edit && kinds.length > 0 ? (
        <View style={styles.chipRow}>
          {kinds.map((k) => (
            // 选中态对齐 SegmentBar（ink 色面 + bg 文字，评审 H2）；primary 只留给发布/保存
            <Pressable
              key={k.key}
              style={[styles.chip, service.kind === k.key && styles.chipActive]}
              onPress={() => service.setKind(service.kind === k.key ? 'standard' : k.key)}
            >
              <Text style={[styles.chipText, service.kind === k.key && styles.chipTextActive]}>
                {k.publisher?.label ?? k.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {service.kind !== 'standard' ? (
        <KindPayloadForm service={service} manifest={manifest} kindKey={service.kind} />
      ) : (
        fields.map((f) => (
          <View key={f.key}>
            <Text style={styles.label}>{f.label}</Text>
            <MomentFieldControl service={service} field={f} />
          </View>
        ))
      )}
    </View>
  );
});
```

- [ ] **Step 3: 发布面板接入**

Modify `apps/app/src/features/compose/index.tsx`：
- import 区加 `import { TemplateFields } from './template-fields';`
- 链选择 chips 的 `onPress={() => service.setChain(c.id)}` 无需改（service.setChain 已在 Step 1 扩展为重置版）。
- 插在 showPicker 的 DateTimePicker 块之后（评审 S3，已核实现状：compose/index.tsx L140–144 是「发生时间」dateBtn Pressable，L145–155 是 `{service.showPicker ? (<DateTimePicker ... />) : null}` 块——插在 L155 之后、tag chips 块之前）：
  ```tsx
  <TemplateFields service={service} edit={service.isEdit} />
  ```
- ChainListService 晚就绪时的 manifest 重试通道（评审 B2，配合 service 守卫的「不匹配清占位」）——hydrate 的 useEffect 之后加：
  ```tsx
  useEffect(() => {
    // activeChainId 经 observer 订阅 ChainListService：链列表就绪 / 用户切链时本 effect 重触发；
    // loadManifest 同链幂等（manifestChainId 占位），重复调用无副作用
    const active = service.activeChainId;
    if (active) void service.loadManifest(active).catch(() => undefined);
  }, [service, service.activeChainId]);
  ```
- `onSubmit` 的 catch 分支已能展示前置校验 Error 的中文 message（含「选一项或写一句，再发布」），无需改。

- [ ] **Step 4: 运行确认通过**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0（含 lint:tokens 零命中）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/compose/
git commit -m "feat(app): render template fields in composer from manifest"
```

---

### Task 5: 链主页聚合视图段（curve/milestone-axis/moodline/trips 分章）+ 时刻卡模板呈现

**Files:**
- Create: `apps/app/src/features/chain-home/aggregate-views.tsx`
- Modify: `apps/app/src/features/chain-home/chain-home.service.ts`
- Modify: `apps/app/src/features/chain-home/index.tsx`
- Modify: `apps/app/src/components/MomentCard.tsx`（模板呈现：里程碑 label、mood、geo 地名、年龄标注）
- Test: 无

**Interfaces:**
- Consumes: `client.getAggregate`（P4 Task 1）；Task 3 的 `babyAgeLabel` / `groupMomentsByTrips` / `resolveMilestoneLabel` / `summarizePayload` / `METRIC_LABELS`；dto `AggregateResponse` / `ChainDetailDto` / `TemplateManifest`。
- Produces:
  - `ChainHomeService` 增 `activeView: string`（`'timeline'` / `'tags'` / `'trips'` / 其他视图 type）、`aggregate: AggregateResponse | null`、`setActiveView(view): void`、`loadAggregate(): Promise<void>`；`chain` 字段类型升级为 `ChainDetailDto | null`
  - `<AggregateView view aggregate moments chainPayload hasMore isLoading error onRetry map>` 组件（curve/milestone-axis/moodline/trips 分章；map 槽 Task 6 注入；**三态自承**——P4 H3）
  - `MomentCard` 增可选 prop `templateManifest?: TemplateManifest | null`、`ageLabel?: string`

- [ ] **Step 1: ChainHomeService 接入视图状态**

Modify `apps/app/src/features/chain-home/chain-home.service.ts`：
- import 类型行改为 `import type { AggregateResponse, ChainDetailDto, MomentResponse, TagResponse } from '@moment/dto';`（删 `ChainDto`）
- `chain: ChainDto | null = null;` 改为 `chain: ChainDetailDto | null = null;`
- `ChainSegment` 类型行改为（视图 tab 动态化后不再限于两段）：
  ```ts
  /** 链首页段：'timeline' 主时间线 / 'tags' 标签 / 'trips' 行程分章 / 其余为 manifest.views 声明的视图 type */
  export type ChainSegment = string;
  ```
- 字段区（`tags` 行后）加：
  ```ts
  /** 当前聚合视图的投影数据（timeline/tags/trips 不用端点，为 null） */
  aggregate: AggregateResponse | null = null;
  /** 组件段切换时同步写入（段 state 留在组件 useState，加载逻辑在 service） */
  activeView = 'timeline';
  ```
- `hydrate` 中 `this.tags = [];` 行后加：
  ```ts
    this.aggregate = null;
    this.activeView = 'timeline';
  ```
- `loadTags` 声明后加 `hasMore` getter（`nextCursor` 是 private，组件段与 trips 统计范围提示需要）：
  ```ts
  /** 时间线是否还有未加载页（trips 视图统计范围提示用，P4 H2） */
  get hasMore(): boolean {
    return this.nextCursor !== null;
  }
  ```
- 类末尾加：
  ```ts
  /** 段切换（组件 SegmentBar onChange 时调用）：记录当前段；聚合段触发加载。 */
  setActiveView(view: string): void {
    this.activeView = view;
    this.aggregate = null;
    if (view !== 'timeline' && view !== 'tags' && view !== 'trips') {
      void this.loadAggregate().catch(() => undefined);
    }
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
- 构造函数 `moment:changed` 监听内 `void this.loadFirst()...` 后加：
  ```ts
        if (this.activeView !== 'timeline' && this.activeView !== 'tags' && this.activeView !== 'trips') {
          void this.loadAggregate().catch(() => undefined);
        }
  ```

- [ ] **Step 2: 聚合视图组件**

Create `apps/app/src/features/chain-home/aggregate-views.tsx`：
```tsx
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { AggregateResponse, MomentResponse } from '@moment/dto';
import { METRIC_LABELS, groupMomentsByTrips, type Trip } from '../../lib/template';
import { formatMomentTime } from '../../lib/format';
import { Button } from '../../components/Button';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// 聚合视图词表渲染器（spec §5）：curve / milestone-axis / moodline / timeline(trips)。
// curve 用 react-native-svg 手绘（不引图表库）；map 在 ./map-view.tsx（Task 6）注入。
// 聚合投影不携带 happenedTzOffset（P3 投影形状），时间展示用查看者本地偏移——
// 家庭成员同时区的目标场景下无差（继承 P4 决策 7）。
const viewerTz = new Date().getTimezoneOffset();

/** 成长曲线：按 metric 拆线，SVG 手绘。 */
function CurveView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'curve' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const byMetric = new Map<string, { value: number; unit: string; at: string }[]>();
  for (const p of aggregate.points) {
    const list = byMetric.get(p.metric) ?? [];
    list.push({ value: p.value, unit: p.unit, at: p.happenedAt });
    byMetric.set(p.metric, list);
  }
  const metrics = [...byMetric.entries()];
  if (metrics.length === 0) {
    return <Text style={styles.empty}>还没有成长记录，记下第一次身高体重后曲线会在这里长出来。</Text>;
  }
  const W = 320;
  const H = 160;
  const PAD = 24;
  return (
    <View style={styles.section}>
      {metrics.map(([metric, points]) => {
        const label = METRIC_LABELS[metric] ?? metric;
        const unit = points[0]!.unit;
        const values = points.map((p) => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(points.length - 1, 1);
        const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
        const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
        const latest = points[points.length - 1]!;
        return (
          <View key={metric} style={styles.card}>
            <Text style={styles.cardTitle}>
              {label} <Text style={styles.muted}>最近 {latest.value}{unit}</Text>
            </Text>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={`${label}曲线`}>
              <Path d={d} fill="none" stroke={t.action} strokeWidth={2} />
              {points.map((p, i) => (
                <Circle key={`${p.at}-${i}`} cx={x(i)} cy={y(p.value)} r={3} fill={t.action} />
              ))}
            </Svg>
            <View style={styles.scaleRow}>
              <Text style={styles.muted}>{min}{unit}</Text>
              <Text style={styles.muted}>{max}{unit}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 里程碑轴：目录 icon + label + 发生时刻 + note，按时间正序（成长向上读）。 */
function MilestoneAxisView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'milestone-axis' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (aggregate.items.length === 0) {
    return <Text style={styles.empty}>还没有里程碑，第一次微笑、第一次走路……都值得在这里留个位置。</Text>;
  }
  return (
    <View style={styles.section}>
      {aggregate.items.map((item) => (
        <View key={item.momentId} style={styles.axisRow}>
          <Text style={styles.body}>{item.icon ?? '·'}</Text>
          <Text style={styles.axisLabel}>{item.label}</Text>
          <Text style={styles.muted}>{formatMomentTime(item.happenedAt, viewerTz)}</Text>
          {item.note ? <Text style={styles.muted}>{item.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** 心情线：按墙钟日的心情分布（date + emoji × count），新日在前。 */
function MoodlineView({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'moodline' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (aggregate.days.length === 0) {
    return <Text style={styles.empty}>还没有心情记录，发时刻时选一抹心情。</Text>;
  }
  const days = [...aggregate.days].sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <View style={styles.section}>
      {days.map((d) => (
        <View key={`${d.date}-${d.mood}`} style={styles.moodRow}>
          <Text style={styles.moodDate}>{d.date.slice(5)}</Text>
          <Text style={styles.body} accessibilityLabel={`心情 ${d.mood}，${d.count} 次`}>
            {Array.from({ length: Math.min(d.count, 10) }, () => d.mood).join('')}
            {d.count > 10 ? ` ×${d.count}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 行程分章（timeline + groupBy:'trips'）：用已加载 moments 前端分组，不打聚合端点。
 *  已知限制（P4 H2）：只统计当前已加载的分页数据，视图内注明统计范围。 */
function TripsView({ moments, chainPayload, hasMore }: { moments: MomentResponse[]; chainPayload: Record<string, unknown> | null; hasMore: boolean }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const trips = (chainPayload?.trips ?? []) as Trip[];
  if (trips.length === 0) {
    return <Text style={styles.empty}>还没有行程，在链设置里补一段行程（名称与起止日期），时刻会按行程归章。</Text>;
  }
  const { sections, outside } = groupMomentsByTrips(moments, trips);
  return (
    <View style={styles.section}>
      <Text style={styles.muted}>
        {hasMore ? `统计已加载的 ${moments.length} 条时刻（时间线段继续往下翻可加载更多）` : `共 ${moments.length} 条时刻`}
      </Text>
      {sections.map((s) => (
        <View key={`${s.name}-${s.start}`} style={styles.tripCard}>
          <Text style={styles.cardTitle}>
            {s.name} <Text style={styles.muted}>{s.start} ~ {s.end} · {s.moments.length} 条</Text>
          </Text>
          {s.moments.length === 0 ? (
            <Text style={styles.muted}>已加载的范围里还没有这段行程的时刻。</Text>
          ) : (
            s.moments.map((m) => (
              <Text key={m.id} style={styles.tripMoment}>
                {formatMomentTime(m.happenedAt, m.happenedTzOffset)} · {m.content.slice(0, 40) || '（图片/视频）'}
              </Text>
            ))
          )}
        </View>
      ))}
      {outside.length > 0 ? <Text style={styles.muted}>另有 {outside.length} 条不在任何行程日期内。</Text> : null}
    </View>
  );
}

/** 视图分发（词表 switch；view='trips' 是 timeline+groupBy:'trips' 的 tab id；map 由 Task 6 注入）。
 *  三态自承（P4 H3）：loading / error（可重试）/ 空数据。 */
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
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  /** map 视图组件由 Task 6 注入（避免本文件引 react-native-maps） */
  map?: (props: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) => ReactNode;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (view === 'trips') {
    return <TripsView moments={moments} chainPayload={chainPayload} hasMore={hasMore} />;
  }
  if (isLoading && !aggregate) {
    return <Text style={styles.empty}>加载中…</Text>;
  }
  if (error && !aggregate) {
    return (
      <View style={styles.section}>
        <Text style={styles.empty}>{error}</Text>
        <Button variant="secondary" onPress={onRetry}>重试</Button>
      </View>
    );
  }
  if (view === 'map') {
    return <>{aggregate?.view === 'map' ? map?.({ aggregate }) : null}</>;
  }
  if (!aggregate) return null; // 防御兜底：loading/error 分支已覆盖正常路径
  if (aggregate.view === 'curve') return <CurveView aggregate={aggregate} />;
  if (aggregate.view === 'milestone-axis') return <MilestoneAxisView aggregate={aggregate} />;
  if (aggregate.view === 'moodline') return <MoodlineView aggregate={aggregate} />;
  return null;
}

const createStyles = (t: Theme) =>
  // 尺寸全部上 token 档（H1：新文件不吃旧值的迁移平移豁免）
  StyleSheet.create({
    section: { padding: t.space4, gap: t.space3 },
    empty: { color: t.muted, fontSize: t.fontSupport, textAlign: 'center', padding: t.space8 },
    card: { backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3, gap: t.space2 },
    cardTitle: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    muted: { fontSize: t.fontSupport, color: t.muted },
    body: { fontSize: t.fontBody, color: t.ink },
    scaleRow: { flexDirection: 'row', justifyContent: 'space-between' },
    axisRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space2, backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3 },
    axisLabel: { fontSize: t.fontBody, color: t.ink, fontWeight: '600' },
    moodRow: { flexDirection: 'row', alignItems: 'center', gap: t.space3 },
    // 日期列不定宽：MM-DD 等长格式自然对齐，避免一次性尺寸（评审 H1）
    moodDate: { flexShrink: 0, fontSize: t.fontSupport, color: t.muted },
    tripCard: { backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1 },
    tripMoment: { fontSize: t.fontSupport, color: t.muted },
  });
```

- [ ] **Step 3: 时刻卡模板呈现（milestone/mood/geo/年龄）**

Modify `apps/app/src/components/MomentCard.tsx`：
- import 区加：
  ```tsx
  import type { TemplateManifest } from '@moment/dto';
  import { resolveMilestoneLabel, summarizePayload } from '../lib/template';
  ```
- props 类型改为：
  ```tsx
  {
    moment: MomentResponse;
    onPress: () => void;
    onLongPress?: () => void;
    /** 链模板 manifest（链主页传入；feed/详情不传则不显示结构化摘要——v1 已知限制，同 P4） */
    templateManifest?: TemplateManifest | null;
    /** baby 年龄标注（「1 岁 2 个月」）；调用方按链 payload.birthdate 计算 */
    ageLabel?: string;
  }
  ```
  解构加 `templateManifest, ageLabel`。
- 时间行的 `{moment.isBackfill ? ' · 补发' : ''}` 后加 `{ageLabel ? ` · ${ageLabel}` : ''}`。
- `<MediaGrid ... />` 之后、`<View style={styles.footer}>` 之前插入模板呈现块（**判重同 P4 H1**：发布兜底填入的 content 与摘要逐字同源，`content.trim() === summaryText` 时跳过摘要行）：
  ```tsx
      {moment.kind !== 'standard' && templateManifest
        ? (() => {
            const p = moment.payload ?? {};
            // 与发布兜底同一函数：判重基准与兜底 content 逐字同源，不重复显示
            const summaryText = summarizePayload(templateManifest, moment.kind, p);
            if (!summaryText || moment.content.trim() === summaryText) return null;
            const { icon } = resolveMilestoneLabel(templateManifest, p); // metric 无 catalog_key → icon 恒 null
            return <Text style={styles.tplLine}>{icon ? `${icon} ${summaryText}` : summaryText}</Text>;
          })()
        : null}
      {moment.kind === 'standard' && typeof moment.payload?.mood === 'string' ? (
        <Text style={styles.tplLine} accessibilityLabel="心情">{moment.payload.mood}</Text>
      ) : null}
      {(() => {
        const geo = moment.payload?.geo as { place_name?: string } | undefined;
        return geo?.place_name ? <Text style={styles.tplLine}>📍 {geo.place_name}</Text> : null;
      })()}
  ```
- `createStyles` 的 StyleSheet.create 对象内加：
  ```ts
    tplLine: { color: t.muted, fontSize: t.fontSupport, marginTop: t.space1 },
  ```

- [ ] **Step 4: 链主页接入视图段**

Modify `apps/app/src/features/chain-home/index.tsx`：
- import 区：把 `ScrollView` 并入既有 react-native import 列表（`import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';` → 列表内加 ScrollView）；另新增两行：
  ```tsx
  import { AggregateView } from './aggregate-views';
  import { babyAgeLabel } from '../../lib/template';
  ```
- `const [segment, setSegment] = useState<ChainSegment>('timeline');` 不变（ChainSegment 已是 string）；`setSegment` 调用处改为同时通知 service：
  ```tsx
  function onSegment(v: ChainSegment): void {
    setSegment(v);
    service.setActiveView(v);
  }
  ```
- SegmentBar 的 `options` 改为动态（模板视图 tab 插在「时间线」与「标签」之间；tab id 约定：timeline+groupBy:'trips' → 'trips'，其余用 v.type）：
  ```tsx
  const viewTabs = (service.chain?.templateManifest?.views ?? [])
    .filter((v) => v.type !== 'timeline' || v.groupBy === 'trips')
    .map((v) => ({ value: v.type === 'timeline' ? ('trips' as const) : v.type, label: v.label }));
  ```
  options 改为：
  ```tsx
        options={[
          { value: 'timeline', label: '时间线' },
          ...viewTabs,
          { value: 'tags', label: `标签 ${service.tags.length}` },
        ]}
        value={segment}
        onChange={onSegment}
  ```
- `{segment === 'tags' ? ... : null}` 行后加聚合视图段（map 槽 Task 6 才注入，此处先不传 map prop）：
  ```tsx
      {segment !== 'timeline' && segment !== 'tags' ? (
        <ScrollView>
          <AggregateView
            view={segment}
            aggregate={service.aggregate}
            moments={service.moments}
            chainPayload={service.chain?.payload ?? null}
            hasMore={service.hasMore}
            isLoading={service.$model.loadAggregate.loading}
            error={service.$model.loadAggregate.error ? humanError(service.$model.loadAggregate.error) : null}
            onRetry={() => void service.loadAggregate().catch(() => undefined)}
          />
        </ScrollView>
      ) : null}
  ```
- timeline 段的 `renderItem` 内 `<MomentCard ... />` 加两个透传：
  ```tsx
              templateManifest={service.chain?.templateManifest ?? null}
              ageLabel={(() => {
                const birthdate = service.chain?.payload?.birthdate;
                return typeof birthdate === 'string' ? babyAgeLabel(birthdate, item.happenedAt, item.happenedTzOffset) : undefined;
              })()}
  ```

- [ ] **Step 5: 运行确认通过**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0（含 lint:tokens 零命中——曲线/地图颜色均来自 theme 变量）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/chain-home/ apps/app/src/components/MomentCard.tsx
git commit -m "feat(app): add aggregate view segments and template moment rendering"
```

---

### Task 6: 地图视图（react-native-maps）接入链主页

**Files:**
- Create: `apps/app/src/features/chain-home/map-view.tsx`
- Modify: `apps/app/src/features/chain-home/index.tsx`（AggregateView 注入 map）
- Test: 无（地图手动验收）

**Interfaces:**
- Consumes: Task 1 的 react-native-maps；Task 5 的 `AggregateView`（map 注入槽）。
- Produces: `<FootprintMap aggregate>`（react-native-maps + Circle 点图；初始区域取首点 ±0.5°）。

- [ ] **Step 1: 地图视图组件**

Create `apps/app/src/features/chain-home/map-view.tsx`：
```tsx
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle } from 'react-native-maps';
import type { AggregateResponse } from '@moment/dto';
import { formatMomentTime } from '../../lib/format';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// 足迹地图（travel 模板）：react-native-maps（Expo Go 内置，EAS autolinking）。
// iOS 默认 Apple Maps 零配置；Android 正式包需 Google Maps API key
// （app.config.ts 的 android.config.googleMaps.apiKey，发布前配置，见 DoD 风险声明）。
// 点位用 Circle 不用 Marker——Marker 的 callout 样式定制成本高，Circle 满足足迹场景。
// 聚合投影无 happenedTzOffset，弹层时间用查看者本地偏移（继承 P4 决策 7）。
// 地图嵌在链主页聚合段的 ScrollView 内：固定高容器 + Android 手势竞争需手动验收（DoD 清单第 9 项）。

export function FootprintMap({ aggregate }: { aggregate: Extract<AggregateResponse, { view: 'map' }> }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  if (aggregate.points.length === 0) {
    return <Text style={styles.empty}>还没有足迹，发时刻时添加位置。</Text>;
  }
  const first = aggregate.points[0]!;
  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: first.lat,
          longitude: first.lng,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
      >
        {aggregate.points.map((p) => (
          <Circle
            key={p.momentId}
            center={{ latitude: p.lat, longitude: p.lng }}
            radius={300}
            fillColor={t.action}
            strokeColor={t.action}
          />
        ))}
      </MapView>
      <View style={styles.list}>
        {aggregate.points.map((p) => (
          <Text key={p.momentId} style={styles.item}>
            📍 {p.placeName ?? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`} · {formatMomentTime(p.happenedAt, new Date().getTimezoneOffset())}
          </Text>
        ))}
      </View>
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: { padding: t.space4, gap: t.space2 },
    // 320pt 是组件视口尺寸（非布局间距档位），同 web 端 h-80 先例（P4 S9）
    map: { height: 320, borderRadius: t.radiusMd },
    list: { gap: t.space1 },
    item: { fontSize: t.fontSupport, color: t.ink },
    empty: { color: t.muted, fontSize: t.fontSupport, textAlign: 'center', padding: t.space8 },
  });
```

Modify `apps/app/src/features/chain-home/index.tsx`——import 加 `import { FootprintMap } from './map-view';`；`<AggregateView ... />` 调用加 prop：
```tsx
            map={(props) => <FootprintMap {...props} />}
```

- [ ] **Step 2: 运行确认通过**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0。

- [ ] **Step 3: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/chain-home/
git commit -m "feat(app): add footprint map view"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/app typecheck` / `lint`（含 lint:tokens 零命中）均 exit 0
- [ ] P3 中间态消除：app 全仓 typecheck 不再因 `createChain` 缺 template 报错
- [ ] 词表纪律自查：`grep -rn "=== 'baby'\|=== 'travel'\|=== 'daily'" apps/app/src` 无命中（模板 key 不出现在渲染分支里）
- [ ] **已知限制声明（继承 P4）**：TripsView 只统计已加载的分页 moments（视图内有「统计已加载的 N 条」注明）；feed 首页与 moment 详情页不显示里程碑/数值摘要（mood/geo 地名正常显示）；聚合投影不含 happenedTzOffset，里程碑轴/地图弹层用查看者本地偏移；链设置 payload 编辑 UI（补录生日/行程）不进本轮
- [ ] **风险声明**：Android 正式包的地图需 Google Maps API key（`app.config.ts` 的 `android.config.googleMaps.apiKey`，发布前配置；Expo Go / iOS 不受影响）
- [ ] **手动验收清单**（Expo Go 或模拟器，按 spec §5 与编排 T6）：
  1. 建 baby 链（选「宝宝成长」模板，页面明示「模板选定后不可更改」）→ 发布面板出「记一个里程碑 / 记身高体重」入口 → 记里程碑（目录 chips 选「第一次微笑」）→ 时刻卡显示 😊 第一次微笑 → 链主页「里程碑」段出轴 → 记身高体重 →「成长曲线」段出 SVG 双线。
  2. baby 链补录生日（经 API 补录，链设置 UI 后置）后，时刻卡时间旁显示「N 岁 N 个月」。
  3. 建 travel 链 → 发时刻点「添加位置」（授权定位）→ 卡片显示 📍 地名 →「足迹地图」段出地图与点位 → 链 payload 配 trips 后「行程」段按行程分章。
  4. 建 daily 链 → 发时刻选心情 😄 → 卡片显示心情 →「心情曲线」段出按日分布。
  5. 编辑一条 milestone moment：不切换 kind，改 note 保存成功（S4：payload 显式携带）；编辑 standard moment 把心情从 😄 改 😭 再清空，均保存成功。
  6. compose 内从 baby 链切到 daily 链：kind/草稿被重置（H4），daily 链只显示心情字段。
  7. 定位权限拒绝时发布面板弹人话文案（「没拿到定位权限…」Alert），不崩溃、不留半成品草稿。
  8. 从 feed 首页发布入口（无 chainId 参数）进 compose：等链列表就绪后模板字段正常出现（评审 B2 重试通道）；选链/切链后字段跟着换。
  9. Android 上地图视图拖动/缩放与外层 ScrollView 滚动不打架（手势竞争，评审 S5）。
- [ ] 执行 prompt T6 Produces 逐个可解析：模板卡片选择器 / 词表发布器渲染器 / 聚合视图渲染器 / expo-location 定位
