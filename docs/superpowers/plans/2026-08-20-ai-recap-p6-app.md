# AI 月度回顾 P6：app recap UI（Expo）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** app（Expo RN）端接入 AI 月度回顾：链主页 recap 入口条（存在最近一期 ready/degraded 回顾时渲染，点击进入 recap 页）、recap 页（Markdown 正文 + 高光时刻跳转）。

**Architecture:** 与 P5（web）同一套产品行为、同一批上游契约，组件实现按 RN 重写。recap 入口条与 app 端「那年今日入口条」（`MemoriesEntryBar`）同模式——页面级 Service + `bindServices(observer(...), [Service])`，有内容才渲染，点击 `router.push` 导航到 recap 页。Markdown 正文用 RN 最小渲染（Text + 段落拆分，不引新依赖）。app 端无分享页（`apps/app/CLAUDE.md`：分享链接落 web 公开页），分享页 recap 展示在 P5 web 已覆盖，本计划无对应 Task。

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19 / @rabjs/react（Service 模式）/ @moment/api-client。

**Spec:** `docs/superpowers/specs/2026-08-20-ai-recap-design.md`（§7 各端 UX、§6 API 设计）

## Spec 引用（六份 C 端设计规范）

app 端 UI 遵循 web C 端设计规范的同源视觉语义（通过 `apps/app/src/theme/tokens.ts` 的 token 映射），不另立样式约定：

- `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`
- `docs/superpowers/specs/2026-08-18-web-button-design.md`
- `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`
- `docs/superpowers/specs/2026-08-18-web-field-input-design.md`
- `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`
- `docs/superpowers/specs/2026-08-18-web-feedback-design.md`

## Global Constraints

- 执行 prompt T6 契约：`docs/superpowers/prompts/2026-08-20-ai-recap-execution.md`。
- 上游契约（已定稿）：T1 dto `RecapDto` / `RecapListResponse` / `periodSchema`（`packages/dto/src/recaps.ts`）；T4 端点 `GET /api/chains/:chainId/recaps`、`GET /api/chains/:chainId/recaps/:period`；P5 Task 1 api-client `listRecaps` / `getRecap`（app 经 `src/lib/api.ts` 的 `client` 直接消费，**本计划不动 api-client**）。
- **app 端硬约束（`apps/app/CLAUDE.md`）**：新代码消费 `useTheme()`；**禁 hex/rgba 字面量**（`lint:tokens` 门禁，唯一豁免 `src/theme/tokens.ts`）；间距只用 `space1..space8`、字号只用 `fontCaption..fontInput`、命中区 ≥ `touchMin`；按钮一律走 `src/components/Button.tsx`；rab 纪律（bindServices/observer、禁解构 observable、跨域刷新只走 `'global'` 事件）；app 包**无测试基建**（无 vitest），门禁 = `typecheck` + `lint` + 手动验收（CONVENTIONS §4），本计划不新增测试框架。
- **app 无分享页**（`apps/app/CLAUDE.md`）：分享链接落 web 公开页（`src/lib/api.ts` 的 `webUrl`）。分享页 recap 展示在 P5 web 已覆盖，本计划无对应 Task。执行 prompt T6 Produces 含「分享页展示」——app 端不适用，注明偏差。
- **Markdown 渲染**：app 端无 markdown 组件（`moment.content` 用 `<Text>` 纯文本渲染）。本计划用 RN 最小渲染（Text + 段落拆分 + 标题/列表检测，不引新依赖，spec §10 演进项）。
- 每 Task 一个 commit（conventional commits `feat(app): ...`）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **入口条点击导航**：spec §7「点击进入链内 recap 页」。app 端那年今日入口条（`MemoriesEntryBar`）也是点击 `router.push` 导航到详情页，与 recap 入口条交互一致。
2. **app 无分享页**：执行 prompt T6 Produces 含「分享页展示」，但 `apps/app/CLAUDE.md` 明确「app 无分享页」。分享页 recap 只在 web 端（P5 Task 4）。本计划注明偏差，不补 app 分享页。
3. **Markdown 最小渲染**：spec §7「Markdown 正文」。app 端无 markdown 库，用 Text + 段落拆分（标题用大字号 + 加粗、列表用 · 前缀、加粗用正则去 ** 标记），不引新依赖。

---

### Task 1: recap 入口条（Service + 组件 + 链主页接入）

**Files:**
- Create: `apps/app/src/features/recap/recap-entry.service.ts`
- Create: `apps/app/src/features/recap/recap-entry.tsx`
- Modify: `apps/app/src/features/chain-home/index.tsx`（入口条嵌入）
- Test: 无（app 无测试基建，CONVENTIONS §4）

**Interfaces:**
- Consumes: P5 Task 1 的 `client.listRecaps`；dto `RecapDto` / `RecapListResponse`；既有 `router`（`expo-router`）、`useTheme()`。
- Produces:
  - `RecapEntryService`（`recap-entry.service.ts`）：`chainId = ''`、`latest: RecapDto | null = null`、`hydrate(chainId: string): void`、`load(): Promise<void>`
  - `<RecapEntryBar chainId />` 组件：存在最近一期 ready/degraded 回顾时渲染入口条，点击 `router.push` 到 recap 页

- [ ] **Step 1: 实现 RecapEntryService**

Create `apps/app/src/features/recap/recap-entry.service.ts`：
```ts
import { Service } from '@rabjs/react';
import type { RecapDto } from '@moment/dto';
import { client } from '../../lib/api';

/**
 * recap 入口条 Service（spec §7：存在最近一期 ready/degraded 回顾时渲染）。
 * 页面级 Service（bindServices 注入），非全局——只在链主页使用。
 * 失败降级：latest 保持 null → 入口条不渲染，不阻塞链主页。
 */
export class RecapEntryService extends Service {
  chainId = '';
  latest: RecapDto | null = null;

  /** 链主页 hydrate 时调用；幂等挡双调用。 */
  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.latest = null;
    void this.load().catch(() => undefined); // 错误静默：入口条不渲染
  }

  async load(): Promise<void> {
    const res = await client.listRecaps(this.chainId);
    const first = res.recaps[0];
    if (!first) return;
    if (first.status === 'ready' || first.status === 'degraded') {
      this.latest = first;
    }
  }
}
```

- [ ] **Step 2: 实现 recap 入口条组件**

Create `apps/app/src/features/recap/recap-entry.tsx`：
```tsx
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';
import { RecapEntryService } from './recap-entry.service';

// recap 入口条（spec §7）：与那年今日入口条同视觉模式——
// 有内容才渲染（if !latest return null），点击 router.push 到 recap 页。

/** period 格式化为展示文案：「2026-07」→「7 月回顾」 */
function periodLabel(period: string): string {
  const month = period.slice(5);
  return `${Number(month)} 月回顾`;
}

const RecapEntryBarContent = observer(function RecapEntryBarContent({
  chainId,
}: {
  chainId: string;
}) {
  const service = useService(RecapEntryService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  const latest = service.latest;
  if (!latest) return null;

  const degraded = latest.status === 'degraded';

  return (
    <Pressable
      style={styles.bar}
      onPress={() =>
        router.push({
          pathname: '/chains/[chainId]/recaps/[period]',
          params: { chainId, period: latest.period },
        })
      }
    >
      <Text style={styles.barText}>📅 {periodLabel(latest.period)}</Text>
      {degraded ? <Text style={styles.barTag}>（简版）</Text> : null}
      <Text style={styles.barArrow}>→</Text>
    </Pressable>
  );
});

export const RecapEntryBar = bindServices(RecapEntryBarContent, [RecapEntryService]);

// recap 入口条为新代码，间距/圆角上 token 档位（space1/space2/radiusMd），与 recap-page highlightCard 自洽。
const createStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: t.space3,
      marginTop: t.space2,
      marginBottom: t.space1,
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      minHeight: t.touchMin,
    },
    barText: { flex: 1, fontSize: t.fontLabel, color: t.ink },
    barTag: { fontSize: t.fontCaption, color: t.muted, marginLeft: t.space1 },
    barArrow: { fontSize: t.fontLabel, color: t.muted, marginLeft: t.space2 },
  });
```

- [ ] **Step 3: 链主页接入入口条**

Modify `apps/app/src/features/chain-home/index.tsx`：
- import 区加 `import { RecapEntryBar } from '../recap/recap-entry';`
- SegmentBar 之前（header 之后）插入：
```tsx
      <RecapEntryBar chainId={service.chainId} />
```

- [ ] **Step 4: 运行确认**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0（含 lint:tokens 零命中）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/recap/recap-entry.service.ts apps/app/src/features/recap/recap-entry.tsx apps/app/src/features/chain-home/index.tsx
git commit -m "feat(app): add recap entry bar on chain home"
```

---

### Task 2: recap 页（路由 + Service + Markdown 正文 + 高光跳转）

**Files:**
- Create: `apps/app/src/features/recap/recap-page.service.ts`
- Create: `apps/app/src/features/recap/recap-markdown.tsx`（RN 最小 Markdown 渲染）
- Create: `apps/app/src/features/recap/recap-page.tsx`
- Create: `apps/app/app/chains/[chainId]/recaps/[period].tsx`（路由薄壳）
- Test: 无（app 无测试基建）

**Interfaces:**
- Consumes: P5 Task 1 的 `client.getRecap` / `client.getMoment`；dto `RecapDto` / `MomentResponse`；既有 `router`（`expo-router`）、`useTheme()`。
- Produces:
  - `RecapPageService`（`recap-page.service.ts`）：`chainId = ''`、`period = ''`、`recap: RecapDto | null = null`、`highlights: MomentResponse[]`、`hydrate(chainId, period): void`、`load(): Promise<void>`
  - `<RecapMarkdownText content />` 组件：RN 最小 Markdown 渲染（标题/列表/段落）
  - `<RecapPage />` 组件 + 路由 `/chains/[chainId]/recaps/[period]`

- [ ] **Step 1: 实现 RecapPageService**

Create `apps/app/src/features/recap/recap-page.service.ts`：
```ts
import { Service } from '@rabjs/react';
import type { MomentResponse, RecapDto } from '@moment/dto';
import { client } from '../../lib/api';

/**
 * recap 详情页 Service（spec §7：Markdown 正文 + 高光时刻区）。
 * 页面级 Service（bindServices 注入）。
 * hydrate(chainId, period) 幂等挡双调用，reset 后拉取 recap + 高光 moments。
 */
export class RecapPageService extends Service {
  chainId = '';
  period = '';
  recap: RecapDto | null = null;
  highlights: MomentResponse[] = [];

  hydrate(chainId: string, period: string): void {
    if (this.chainId === chainId && this.period === period) return;
    this.chainId = chainId;
    this.period = period;
    this.recap = null;
    this.highlights = [];
    void this.load().catch(() => undefined);
  }

  async load(): Promise<void> {
    const recap = await client.getRecap(this.chainId, this.period);
    if (recap.chainId !== this.chainId || recap.period !== this.period) return; // 过期响应丢弃
    this.recap = recap;
    const moments = await Promise.all(
      recap.highlights.map((id) => client.getMoment(id).catch(() => null)),
    );
    this.highlights = moments.filter((m): m is MomentResponse => m !== null);
  }
}
```

- [ ] **Step 2: RN 最小 Markdown 渲染组件**

Create `apps/app/src/features/recap/recap-markdown.tsx`：
```tsx
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// RN 最小 Markdown 渲染（spec §10 演进项）。
// 处理 ## / ### 标题、- 列表、**加粗**（去标记纯文本）、段落。
// 不引新依赖；全部消费 theme token。
// RN 无 dangerouslySetInnerHTML，天然防 XSS。

/** 去除 ** 标记（RN Text 不支持 inline 样式拆分，简化为去标记纯文本） */
function stripBold(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}

export function RecapMarkdownText({ content }: { content: string }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  const blocks = content.split(/\n\n+/);

  return (
    <View style={styles.container}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const first = lines[0] ?? '';

        if (first.startsWith('### ')) {
          return <Text key={bi} style={styles.h3}>{stripBold(first.slice(4))}</Text>;
        }
        if (first.startsWith('## ')) {
          return <Text key={bi} style={styles.h2}>{stripBold(first.slice(3))}</Text>;
        }
        if (first.startsWith('# ')) {
          return <Text key={bi} style={styles.h1}>{stripBold(first.slice(2))}</Text>;
        }
        // 列表
        const listLines = lines.filter((l) => l.startsWith('- '));
        if (listLines.length > 0 && lines.every((l) => l.startsWith('- ') || l.startsWith('  '))) {
          return (
            <View key={bi} style={styles.list}>
              {listLines.map((l, li) => (
                <Text key={li} style={styles.listItem}>· {stripBold(l.slice(2))}</Text>
              ))}
            </View>
          );
        }
        // 段落
        return <Text key={bi} style={styles.paragraph}>{stripBold(block)}</Text>;
      })}
    </View>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: { gap: t.space3 },
    h1: { fontSize: t.fontBody, fontWeight: '700', color: t.ink },
    h2: { fontSize: t.fontBody, fontWeight: '600', color: t.ink },
    h3: { fontSize: t.fontLabel, fontWeight: '600', color: t.ink },
    paragraph: { fontSize: t.fontBody, lineHeight: 24, color: t.ink },
    list: { gap: t.space1, paddingLeft: t.space2 },
    listItem: { fontSize: t.fontBody, lineHeight: 24, color: t.ink },
  });
```

- [ ] **Step 3: 实现 recap 页组件**

Create `apps/app/src/features/recap/recap-page.tsx`：
```tsx
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { RecapMarkdownText } from './recap-markdown';
import { RecapPageService } from './recap-page.service';
import { Loading } from '../../components/Loading';
import type { Theme } from '../../theme/theme';
import { useTheme } from '../../theme/use-theme';

// recap 详情页（spec §7）：Markdown 正文 + 高光时刻区（点击跳转 moment 详情）。
// 三态：loading / error（重试）/ 内容。

const RecapPageContent = observer(function RecapPageContent() {
  const params = useLocalSearchParams<{ chainId: string; period: string }>();
  const chainId = params.chainId ?? '';
  const period = params.period ?? '';
  const service = useService(RecapPageService);
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);

  useEffect(() => {
    service.hydrate(chainId, period);
  }, [service, chainId, period]);

  const recap = service.recap;
  const loading = service.$model.load.loading;
  const error = service.$model.load.error;

  if (!recap && (loading || !error)) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ title: '月度回顾' }} />
        <Loading />
      </View>
    );
  }
  if (!recap) {
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ title: '月度回顾' }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>加载失败</Text>
          <Pressable onPress={() => void service.load().catch(() => undefined)}>
            <Text style={styles.action}>重试</Text>
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.action}>返回</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const monthLabel = `${Number(period.slice(5))} 月回顾`;
  const title = recap.status === 'degraded' ? `${monthLabel}（简版）` : monthLabel;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <RecapMarkdownText content={recap.content} />
        {service.highlights.length > 0 ? (
          <View style={styles.highlights}>
            <Text style={styles.sectionTitle}>高光时刻</Text>
            {service.highlights.map((m) => (
              <Pressable
                key={m.id}
                style={styles.highlightCard}
                onPress={() => router.push(`/moments/${m.id}`)}
              >
                {m.content.length > 0 ? (
                  <Text style={styles.highlightContent} numberOfLines={3}>{m.content}</Text>
                ) : null}
                <Text style={styles.highlightDate}>
                  {new Date(m.happenedAt).toLocaleDateString('zh-CN')}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
});

export const RecapPage = bindServices(RecapPageContent, [RecapPageService]);

const createStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: t.bg },
    scroll: { padding: t.space4, gap: t.space4 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space8, gap: t.space3 },
    errorText: { color: t.danger, fontSize: t.fontLabel },
    action: { color: t.action, fontSize: t.fontBody, paddingVertical: t.space1 },
    highlights: { gap: t.space2, marginTop: t.space4 },
    sectionTitle: { fontSize: t.fontBody, fontWeight: '600', color: t.ink },
    highlightCard: { backgroundColor: t.surface, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1, minHeight: t.touchMin },
    highlightContent: { fontSize: t.fontBody, color: t.ink },
    highlightDate: { fontSize: t.fontCaption, color: t.muted },
  });
```

- [ ] **Step 4: 路由薄壳**

Create `apps/app/app/chains/[chainId]/recaps/[period].tsx`：
```tsx
import { RecapPage } from '../../../../src/features/recap/recap-page';
import { RequireAuth } from '../../../../src/components/RequireAuth';

export default function RecapScreen() {
  return (
    <RequireAuth>
      <RecapPage />
    </RequireAuth>
  );
}
```

- [ ] **Step 5: 运行确认**

Run:
```bash
pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint
```
Expected: 均 exit 0（含 lint:tokens 零命中）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/recap/ apps/app/app/chains/
git commit -m "feat(app): add recap page with markdown and highlights"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/app typecheck` / `lint`（含 lint:tokens 零命中）均 exit 0
- [ ] 执行 prompt T6 的 Produces 逐个可解析：recap 入口条 / recap 页（Markdown + 高光跳转）
- [ ] **app 无分享页**（偏差声明）：执行 prompt T6 Produces 含「分享页展示」，但 `apps/app/CLAUDE.md` 明确「app 无分享页」——分享页 recap 只在 web 端（P5 Task 4），app 端分享链接继续指向 web
- [ ] **手动验收清单**（Expo Go 或模拟器，按 spec §7 与编排 T6）：
  1. 建链 → 发若干时刻 → 经 API 或 server 管线生成一期 ready recap → 链主页顶部出现 recap 入口条（「N 月回顾」）→ 点击进入 recap 页。
  2. recap 页：Markdown 正文可读（标题/列表/段落正常渲染）；高光时刻区显示 highlights 引用的 moment 卡片 → 点击跳转该 moment 详情页。
  3. degraded recap：链主页入口条显示「（简版）」→ recap 页标题也显示「（简版）」→ 内容为规则文案。
  4. 无 recap 的链：链主页不显示入口条。
  5. 从链主页切到另一条链：入口条跟着刷新（`hydrate` 幂等 + chainId 变更触发重载）。
