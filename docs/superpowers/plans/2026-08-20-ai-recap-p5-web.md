# AI 月度回顾 P5：web recap UI + api-client 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web 端接入 AI 月度回顾：api-client 加 recap 方法、链主页时间线顶部 recap 入口条（存在最近一期 ready/degraded 回顾时渲染，点击进入链内 recap 页）、recap 页（Markdown 正文 + 高光时刻跳转）、分享只读页渲染 recap。

**Architecture:** recap 入口条与「那年今日入口条」（`MemoriesEntry`）同模式——页面级 Service + `bindServices(observer(...), [Service])`，有内容才渲染（`if (!latest) return null`），点击导航而非同页展开（recap 页是独立路由）。recap 页走 `useParams` + `service.hydrate(chainId, period)` 范式（同 `ShareAlbumService`）。Markdown 正文用最小安全渲染组件（无新依赖——codebase 无既有 markdown 组件，按 spec §10 演进项处理）。高光时刻区复用 highlights 里的 momentId，点击跳 `/moments/:momentId`。

**Tech Stack:** React 19 + Vite / @rabjs/react（Service 模式）/ @moment/api-client / vitest（纯函数单测）。

**Spec:** `docs/superpowers/specs/2026-08-20-ai-recap-design.md`（§7 各端 UX、§6 API 设计）

## Spec 引用（六份 C 端设计规范）

web 端所有页面与组件必须遵循以下已批准规范（`.claude/rules/web-ui.md` 入口），不另立样式约定：

- `docs/superpowers/specs/2026-08-17-web-c-end-redesign.md`
- `docs/superpowers/specs/2026-08-18-web-button-design.md`
- `docs/superpowers/specs/2026-08-18-web-modal-dialog-sheet-design.md`
- `docs/superpowers/specs/2026-08-18-web-field-input-design.md`
- `docs/superpowers/specs/2026-08-18-web-menu-popover-tooltip-design.md`
- `docs/superpowers/specs/2026-08-18-web-feedback-design.md`

## Global Constraints

- 执行 prompt T5 契约：`docs/superpowers/prompts/2026-08-20-ai-recap-execution.md`。
- 上游契约（已定稿）：T1 dto `RecapDto` / `RecapListResponse` / `PublicShareRecap` / `periodSchema`（`packages/dto/src/recaps.ts`）；T4 端点 `GET /api/chains/:chainId/recaps`（`RecapListResponse`，period 倒序）、`GET /api/chains/:chainId/recaps/:period`（`RecapDto`）、分享页 `PublicShareResponse.recap?: RecapDto`（T4 已加 `recap` 字段到 `share.ts`）。
- **六份 C 端设计规范是唯一视觉真相源**：只用 `src/ui/` 的组件与 tokens.css 语义 token；禁止写死色值、一次性尺寸（`px-[18px]`）、负边距通栏（`.claude/rules/web-ui.md`）。
- rab 纪律（`apps/web/CLAUDE.md`）：页面组件 `index.tsx` + 同目录 `.service.ts`；跨域刷新只走 `'global'` 事件；禁止解构 observable；所有 API 访问经 `src/api/client.ts` 的 `client`。
- **Markdown 渲染**：codebase 无既有 markdown 组件（`moment.content` 用 `whitespace-pre-wrap` 纯文本渲染）。本计划用最小安全渲染组件（处理标题/列表/加粗/段落，无新依赖，spec §10 演进项）。
- web 门禁（CONVENTIONS §4）：`pnpm --filter @moment/web typecheck` / `lint` / `build` + 手动验收清单（本计划 DoD）。web 本阶段只做 typecheck+build+lint+手动验收清单，**不进组件测试**。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **入口条点击导航而非同页展开**：spec §7 说「与那年今日入口条同模式」。web 端那年今日入口条（`MemoriesEntry`）是同页展开（`service.toggle()` + 内嵌面板）。但 spec §7 明确说「点击进入链内 recap 页」——recap 是独立路由页（Markdown 正文 + 高光跳转需要整页空间），非同页展开。「同模式」指视觉模式（入口条 + 条件渲染 + 有内容才渲染），非交互模式。
2. **Markdown 最小安全渲染**：spec §7 说「Markdown 正文」。codebase 无 markdown 组件，spec §10 列「v2 视觉理解」为演进项。本计划写最小安全渲染组件（`MarkdownText`，处理 `##`/`###`/`-`/`**`/段落），不引新依赖。若实现中发现需新依赖，停手上报。
3. **入口条在链主页**：spec §7「时间线顶部入口条」。recap 是链级资源（API `GET /chains/:chainId/recaps`），入口条放在链主页（`chain-home`），不在 feed 首页（feed 是多链聚合，无链级 recap 端点）。

---

### Task 1: api-client recap 方法

**Files:**
- Modify: `packages/api-client/src/client.ts`

**Interfaces:**
- Consumes: T1 dto `RecapDto` / `RecapListResponse`（`packages/dto/src/recaps.ts`）；既有 `Http.request`。
- Produces（web 全部后续 Task 消费，不得改名）:
  - `MomentClient.listRecaps(chainId: string): Promise<RecapListResponse>`
  - `MomentClient.getRecap(chainId: string, period: string): Promise<RecapDto>`

- [ ] **Step 1: 改 api-client**

Modify `packages/api-client/src/client.ts`：
- import 类型列表追加 `RecapDto`、`RecapListResponse`。
- `MomentClient` 接口末尾（`getPublicShare` 行后、`listComments` 行前）追加：
```ts
  // recap
  /** 该链回顾列表（period 倒序，spec §6） */
  listRecaps(chainId: string): Promise<RecapListResponse>;
  /** 单条回顾详情（spec §6） */
  getRecap(chainId: string, period: string): Promise<RecapDto>;
```
- 实现对象 `getPublicShare` 行后追加：
```ts
    listRecaps: (chainId) => http.request(`/api/chains/${chainId}/recaps`),
    getRecap: (chainId, period) => http.request(`/api/chains/${chainId}/recaps/${period}`),
```

- [ ] **Step 2: 运行确认**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint
```
Expected: 均 exit 0（api-client 类型变更后 web 消费方暂未引用，不报错；`RecapDto`/`RecapListResponse` 已在 `@moment/dto` 导出）。

- [ ] **Step 3: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/api-client/src/client.ts
git commit -m "feat(web): add recap client methods"
```

---

### Task 2: recap 入口条（Service + 组件 + 链主页接入）

**Files:**
- Create: `apps/web/src/chain/recap-entry.service.ts`
- Create: `apps/web/src/chain/recap-entry.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`（入口条嵌入）
- Test: 无组件测试（门禁 = typecheck/lint/build + DoD 手动验收；CONVENTIONS §4）

**Interfaces:**
- Consumes: Task 1 的 `client.listRecaps`；dto `RecapDto` / `RecapListResponse`；既有 `useNavigate`（`react-router`）。
- Produces:
  - `RecapEntryService`（`recap-entry.service.ts`）：`chainId = ''`、`latest: RecapDto | null = null`、`hydrate(chainId: string): void`、`load(): Promise<void>`
  - `<RecapEntry chainId />` 组件：存在最近一期 ready/degraded 回顾时渲染入口条，点击导航到 `/chains/:chainId/recaps/:period`

- [ ] **Step 1: 实现 RecapEntryService**

Create `apps/web/src/chain/recap-entry.service.ts`：
```ts
import { Service } from '@rabjs/react';
import type { RecapDto } from '@moment/dto';
import { client } from '@/api/client';

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
    // period 倒序，取第一条；仅 ready/degraded 显示（generating/failed 不显示）
    const first = res.recaps[0];
    if (!first) return;
    if (first.status === 'ready' || first.status === 'degraded') {
      this.latest = first;
    }
  }
}
```

- [ ] **Step 2: 实现 recap 入口条组件**

Create `apps/web/src/chain/recap-entry.tsx`：
```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ChevronRight } from 'lucide-react';
import { RecapEntryService } from './recap-entry.service';

// recap 入口条（spec §7）：与那年今日入口条同视觉模式——
// 有内容才渲染（if !latest return null），点击导航到 recap 页（非同页展开）。
// 视觉只消费 token：rounded-surface-lg bg-surface、text-body/text-meta 语义字号，焦点环 ring-focus。

/** period 格式化为展示文案：「2026-07」→「7 月回顾」 */
function periodLabel(period: string): string {
  const month = period.slice(5);
  return `${Number(month)} 月回顾`;
}

export const RecapEntryContent = observer(function RecapEntryContent({
  chainId,
}: {
  chainId: string;
}) {
  const navigate = useNavigate();
  const service = useService(RecapEntryService);

  useEffect(() => {
    service.hydrate(chainId);
  }, [service, chainId]);

  const latest = service.latest;
  if (!latest) return null;

  const degraded = latest.status === 'degraded';

  return (
    <section aria-label="月度回顾" className="mb-6">
      <button
        type="button"
        onClick={() => navigate(`/chains/${chainId}/recaps/${latest.period}`)}
        className="flex w-full items-center gap-3 rounded-surface-lg bg-surface px-4 py-4 text-left transition-colors duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
      >
        <span aria-hidden className="text-body">
          📅
        </span>
        <span className="min-w-0 flex-1 text-body text-ink">
          {periodLabel(latest.period)}
          {degraded && <span className="ml-2 text-meta text-muted">（简版）</span>}
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted" />
      </button>
    </section>
  );
});

export const RecapEntry = bindServices(RecapEntryContent, [RecapEntryService]);
```

- [ ] **Step 3: 链主页接入入口条**

Modify `apps/web/src/pages/chain-home/index.tsx`：
- import 区加 `import { RecapEntry } from '@/chain/recap-entry';`
- `</header>` 之后、视图 tabs nav（`{(() => { const views = ...` 块）之前插入：
```tsx
      <RecapEntry chainId={chain.id} />
```

- [ ] **Step 4: 运行确认**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build
```
Expected: 均 exit 0。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/chain/recap-entry.service.ts apps/web/src/chain/recap-entry.tsx apps/web/src/pages/chain-home/index.tsx
git commit -m "feat(web): add recap entry bar on chain home"
```

---

### Task 3: recap 页（路由 + Service + Markdown 正文 + 高光跳转）

**Files:**
- Create: `apps/web/src/pages/recap/recap-page.service.ts`
- Create: `apps/web/src/pages/recap/markdown-text.tsx`（最小安全 Markdown 渲染组件）
- Create: `apps/web/src/pages/recap/index.tsx`
- Modify: `apps/web/src/App.tsx`（加 recap 路由）
- Test: 无组件测试（门禁 = typecheck/lint/build + DoD 手动验收）

**Interfaces:**
- Consumes: Task 1 的 `client.getRecap` / `client.getMoment`；dto `RecapDto` / `MomentResponse`；既有 `useNavigate`（`react-router`）；ui/feedback `Banner` / `TimelineSkeleton`。
- Produces:
  - `RecapPageService`（`recap-page.service.ts`）：`chainId = ''`、`period = ''`、`recap: RecapDto | null = null`、`highlights: MomentResponse[]`、`hydrate(chainId, period): void`、`load(): Promise<void>`
  - `<MarkdownText content />` 组件：最小安全 Markdown 渲染（标题/列表/加粗/段落）
  - `<RecapPage />` 组件：路由 `/chains/:chainId/recaps/:period`

- [ ] **Step 1: 实现 RecapPageService**

Create `apps/web/src/pages/recap/recap-page.service.ts`：
```ts
import { Service } from '@rabjs/react';
import type { MomentResponse, RecapDto } from '@moment/dto';
import { client } from '@/api/client';

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
    // 高光时刻：逐条拉 moment 详情（highlights 通常 ≤5 条，可接受 N 次查询）
    const moments = await Promise.all(
      recap.highlights.map((id) => client.getMoment(id).catch(() => null)),
    );
    this.highlights = moments.filter((m): m is MomentResponse => m !== null);
  }
}
```

- [ ] **Step 2: 最小安全 Markdown 渲染组件**

Create `apps/web/src/pages/recap/markdown-text.tsx`：
```tsx
import { Fragment, type ReactNode } from 'react';

// 最小安全 Markdown 渲染（spec §10 演进项——v2 可换完整 markdown 库）。
// 处理 LLM 回顾常用的子集：## / ### 标题、- 列表、**加粗**、段落。
// 不引新依赖；全部消费 tokens.css 语义 class（text-body / text-meta / font-semibold 等）。
// 不做 dangerouslySetInnerHTML——纯 React 元素，天然防 XSS。

/** 将 **text** 替换为 <strong>text</strong>（行内加粗，最简正则） */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function MarkdownText({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        // 标题
        if (lines[0]?.startsWith('### ')) {
          return <h3 key={bi} className="text-body font-semibold text-ink">{renderInline(lines[0]!.slice(4))}</h3>;
        }
        if (lines[0]?.startsWith('## ')) {
          return <h2 key={bi} className="text-page-title font-semibold text-ink">{renderInline(lines[0]!.slice(3))}</h2>;
        }
        if (lines[0]?.startsWith('# ')) {
          return <h1 key={bi} className="text-page-title font-semibold text-ink">{renderInline(lines[0]!.slice(2))}</h1>;
        }
        // 列表（- 开头的连续行）
        if (lines.every((l) => l.startsWith('- ') || l.startsWith('  '))) {
          return (
            <ul key={bi} className="flex flex-col gap-1 pl-4">
              {lines.filter((l) => l.startsWith('- ')).map((l, li) => (
                <li key={li} className="text-body text-ink list-disc">{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        // 段落
        return <p key={bi} className="whitespace-pre-wrap text-body text-ink">{renderInline(block)}</p>;
      })}
    </div>
  );
}
```

- [ ] **Step 3: 实现 recap 页组件**

Create `apps/web/src/pages/recap/index.tsx`：
```tsx
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { MarkdownText } from './markdown-text';
import { RecapPageService } from './recap-page.service';
import { Button } from '@/ui/button/index';
import { Banner, TimelineSkeleton } from '@/ui/feedback/index';

// recap 详情页（spec §7）：Markdown 正文 + 高光时刻区（highlights 引用的 moments 卡片，点击跳转详情）。
// 三态：骨架（加载中）/ 错误 Banner（重试）/ 内容。

export const RecapPageContent = observer(function RecapPageContent() {
  const { chainId = '', period = '' } = useParams();
  const navigate = useNavigate();
  const service = useService(RecapPageService);

  useEffect(() => {
    service.hydrate(chainId, period);
  }, [service, chainId, period]);

  const recap = service.recap;
  const loading = service.$model.load.loading;
  const error = service.$model.load.error;

  if (!recap && (loading || !error)) {
    return (
      <div>
        <BackButton onClick={() => navigate(`/chains/${chainId}`)} />
        <TimelineSkeleton />
      </div>
    );
  }
  if (!recap) {
    return (
      <div>
        <BackButton onClick={() => navigate(`/chains/${chainId}`)} />
        <Banner tone="error" action={error && !loading ? { label: '重试', onPress: () => service.load() } : undefined}>
          回顾加载失败，稍后再试试
        </Banner>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <BackButton onClick={() => navigate(`/chains/${chainId}`)} />
        <h1 className="text-page-title font-semibold text-ink">
          {Number(period.slice(5))} 月回顾
          {recap.status === 'degraded' && <span className="ml-2 text-meta font-normal text-muted">（简版）</span>}
        </h1>
      </header>

      <section className="mb-8">
        <MarkdownText content={recap.content} />
      </section>

      {service.highlights.length > 0 && (
        <section aria-label="高光时刻" className="mb-8">
          <h2 className="mb-4 text-body font-semibold text-ink">高光时刻</h2>
          <div className="flex flex-col gap-4">
            {service.highlights.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => navigate(`/moments/${m.id}`)}
                className="flex flex-col gap-1 rounded-surface-lg bg-surface px-4 py-3 text-left transition-colors duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
              >
                {m.content && <span className="text-body text-ink line-clamp-3">{m.content}</span>}
                <span className="text-meta text-muted">{new Date(m.happenedAt).toLocaleDateString('zh-CN')}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
});

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" leadingIcon={ArrowLeft} onClick={onClick}>
      返回
    </Button>
  );
}

export const RecapPage = bindServices(RecapPageContent, [RecapPageService]);
```

- [ ] **Step 4: 加路由**

Modify `apps/web/src/App.tsx`：
- import 区加 `import { RecapPage } from '@/pages/recap';`
- authed 路由组内（`<Route path="/chains/:chainId" ...>` 行后）追加：
```tsx
          <Route path="/chains/:chainId/recaps/:period" element={<RecapPage />} />
```

- [ ] **Step 5: 运行确认**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build
```
Expected: 均 exit 0。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/pages/recap/ apps/web/src/App.tsx
git commit -m "feat(web): add recap page with markdown and highlights"
```

---

### Task 4: 分享只读页渲染 recap

**Files:**
- Modify: `apps/web/src/pages/share-album/share-album.service.ts`（加 `recap` 字段）
- Modify: `apps/web/src/pages/share-album/index.tsx`（渲染 recap 区）
- Test: 无组件测试（门禁 = typecheck/lint/build + DoD 手动验收）

**Interfaces:**
- Consumes: T4 `PublicShareResponse.recap?: RecapDto`（dto `share.ts` 已加）；Task 3 的 `MarkdownText` 组件。
- Produces: `ShareAlbumService` 增 `recap: RecapDto | null`；分享页渲染 recap 只读展示（无评论入口——匿名不可评论的既有约束不变）。

- [ ] **Step 1: ShareAlbumService 加 recap 字段**

Modify `apps/web/src/pages/share-album/share-album.service.ts`：
- import 类型行加 `RecapDto`：改为 `import type { AggregateResponse, MomentResponse, RecapDto, TemplateManifest } from '@moment/dto';`
- 字段区（`aggregates` 行后）加：
```ts
  /** 最近一期 ready/degraded 回顾（share_recaps_enabled 开启时外发，spec §6 + S2 注） */
  recap: RecapDto | null = null;
```
- `hydrate` 中 `this.aggregates = [];` 行后加 `this.recap = null;`
- `loadFirst` 中 `this.aggregates = page.aggregates;` 行后加 `this.recap = page.recap ?? null;`

- [ ] **Step 2: 分享页渲染 recap 区**

Modify `apps/web/src/pages/share-album/index.tsx`：
- import 区加 `import { MarkdownText } from '@/pages/recap/markdown-text';`
- `<main ...>` 内、聚合视图区（`{(() => { const manifest = ...` 块）之前插入 recap 区：
```tsx
        {service.recap && (
          <section className="mb-8">
            <h2 className="mb-4 text-body font-semibold text-ink">
              {Number(service.recap.period.slice(5))} 月回顾
              {service.recap.status === 'degraded' && <span className="ml-2 text-meta font-normal text-muted">（简版）</span>}
            </h2>
            <MarkdownText content={service.recap.content} />
          </section>
        )}
```

- [ ] **Step 3: 运行确认**

Run:
```bash
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web lint && pnpm --filter @moment/web build
```
Expected: 均 exit 0。

- [ ] **Step 4: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/web/src/pages/share-album/
git commit -m "feat(web): render recap on share page"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/web typecheck` / `lint` / `build` 均 exit 0
- [ ] 执行 prompt T5 的 Produces 逐个可解析：api-client `listRecaps` / `getRecap` / recap 入口条 / recap 页（Markdown + 高光跳转）/ 分享页 recap 展示
- [ ] **手动验收清单**（按 spec §7 与编排 T5）：
  1. 建链 → 发若干时刻（含 milestone/metric/mood/geo kind）→ 经 API 或 server 管线生成一期 ready recap → 链主页顶部出现 recap 入口条（「N 月回顾」）→ 点击进入 recap 页。
  2. recap 页：Markdown 正文可读（标题/列表/加粗/段落正常渲染）；高光时刻区显示 highlights 引用的 moment 卡片 → 点击跳转该 moment 详情页。
  3. degraded recap：链主页入口条显示「（简版）」标注 → recap 页标题也显示「（简版）」→ 内容为规则文案。
  4. 无 recap 的链：链主页不显示入口条（`if (!latest) return null`）。
  5. 分享页：开分享链接 → 无痕窗口打开 → recap 区可见（Markdown 只读）→ 无评论入口（匿名不可评论）。
  6. `share_recaps_enabled=false` 的链：分享页不显示 recap 区。
- [ ] Markdown 渲染自查：`grep -rn "dangerouslySetInnerHTML" apps/web/src/pages/recap/` 无命中（纯 React 元素渲染，防 XSS）
