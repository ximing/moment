# AI 月度回顾 P2：server LLM Provider 抽象层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@moment/server` 落地 LLM provider 抽象层：`LLMProvider` 接口、`OpenAICompatProvider`（OpenAI 兼容 chat/completions 实现）、`getLLMProvider()` factory 单例，以及 `RetryableLLMError` / `NonRetryableLLMError` 错误分类。同时在 `config.ts` 加 `LLM_*` 环境变量并同步 `.env.example`。

**Architecture:** provider 层与 storage adapter（CONVENTIONS §3.3）同范式——接口 + 默认实现 + factory 单例。`LLM_API_KEY` 为空时 factory 返回 null（recap 管线整体停用，扫描照常但跳过派发）。provider 通过 `globalThis.fetch` 调远端（Node ≥20 内置），测试用注入式 mock provider 或 `globalThis.fetch` 替身，不依赖真实网络。错误分两类：`RetryableLLMError`（429/5xx/网络/超时，outbox handler 可重试）、`NonRetryableLLMError`（4xx 其他，不重试）。

**Tech Stack:** Node 内置 `fetch` + `AbortController`（超时 60s）/ zod（config）/ jest + supertest（真实测试库，`--runInBand`）。provider 单测不触库，用 mock fetch / 注入式 provider。

**Spec:** `docs/superpowers/specs/2026-08-20-ai-recap-design.md`（§3 LLM Provider 抽象、§8 隐私与安全）

## Global Constraints

- 执行 prompt T2 契约：`docs/superpowers/prompts/2026-08-20-ai-recap-execution.md`；Produces 符号 `LLMProvider` / `LLMChatRequest` / `LLMChatResponse` / `OpenAICompatProvider` / `getLLMProvider` / `setLLMProvider` / `RetryableLLMError` / `NonRetryableLLMError`（携带 `statusCode: number`）逐字不得改；`envSchema`（`export const`，config 模块新增导出，供测试边界校验）同属 T2 契约。
- ESM NodeNext：相对 import 带 `.js` 后缀。
- 环境变量只经 `src/config.ts`（zod）读取，禁止散落 `process.env`；新增变量同步改 `.env.example`。
- 触库测试必须 `afterAll(closeDb)`；provider 单测不触库。
- 每 Task 一个 commit（conventional commits）；Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过。

**Spec 引用与偏差（逐条注明）：**

1. **factory 返回 `LLMProvider | null`**：spec §3 写「`LLM_API_KEY` 为空 → 返回 null（recap 管线整体停用）」。factory 签名据此设计为 `getLLMProvider(): LLMProvider | null`，下游（T3 generateRecap / T4 handler）须 null-check。
2. **错误类 `extends Error` 而非 `extends HttpError`**：provider 层不在请求线程抛 HTTP 错误（worker 调用）；错误分类供 outbox handler（T4）判断是否重试。`RetryableLLMError`/`NonRetryableLLMError` 都 `extends Error`。
3. **超时用 `AbortController` 60s**：spec §3 写「超时 60s」。Node ≥20 内置 `AbortSignal.timeout(60_000)`，但为精确控制（超时抛 `RetryableLLMError` 而非 `DOMException`）用 `AbortController` + `setTimeout` 手动清理。

---

### Task 1: config.ts 加 LLM_* 环境变量 + .env.example 同步

**Files:**
- Modify: `apps/server/src/config.ts`（加 LLM_* zod schema）
- Modify: `apps/server/.env.example`（同步加 LLM_* 注释）
- Test: `apps/server/tests/llm/config.test.ts`

**Interfaces:**
- Consumes: 既有 `config`（`src/config.ts` zod schema + `export const config`）。
- Produces: `config` 新增字段 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_MONTHLY_TOKEN_BUDGET` / `LLM_RECAP_TZ` / `LLM_RECAP_MAX_MOMENTS` / `LLM_RECAP_MAX_CHARS`（T2/T3/T4 全部消费）；`envSchema`（导出的 zod schema 本体，`export const envSchema`，供测试边界校验复用真实 schema 而非同构副本）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/llm/config.test.ts`（纯单测，不触库，无需 resetDb/closeDb）。直接 import 真实 `config` 对象与 `envSchema` 本体验证：config 在 import 时已 `parse(process.env)`（测试库 .env 含全部必填 env，见 `factory.test.ts` 证明 `import { config }` 可行）；envSchema 含 MYSQL_* 等必填字段，故边界拒绝测试用 `{ ...process.env }` 作基底再覆盖坏 LLM 字段（测试进程 env 已被 config.ts 的 dotenv 载入完整，避免在测试里硬编码凭据）：
```ts
import { config, envSchema } from '../../src/config.js';

describe('config LLM 默认值（真实 config 对象）', () => {
  // config 在 import 时已 parse(process.env)（测试库 .env）。
  // 真实断言 config.ts 的字段存在与默认值正确——若 config.ts 漏加字段，访问不存在的属性会 TS 编译失败。
  it('7 个 LLM_* 字段默认值正确', () => {
    expect(config.LLM_BASE_URL).toBe('https://api.deepseek.com/v1');
    expect(config.LLM_API_KEY).toBe('');
    expect(config.LLM_MODEL).toBe('deepseek-chat');
    expect(config.LLM_MONTHLY_TOKEN_BUDGET).toBe(0);
    expect(config.LLM_RECAP_TZ).toBe('Asia/Shanghai');
    expect(config.LLM_RECAP_MAX_MOMENTS).toBe(100);
    expect(config.LLM_RECAP_MAX_CHARS).toBe(8000);
  });
});

describe('envSchema 边界拒绝（真实 zod schema 本体）', () => {
  // envSchema 含 MYSQL_* 等必填字段，parse 坏 LLM 值时需先提供全部必填 env 的合法值。
  // 测试进程的 env 已被 config.ts 的 dotenv 载入完整，故用 { ...process.env } 作基底再覆盖坏 LLM 字段。
  it('LLM_BASE_URL 非 URL 被拒', () => {
    expect(() => envSchema.parse({ ...process.env, LLM_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('LLM_MONTHLY_TOKEN_BUDGET 负数被拒', () => {
    expect(() => envSchema.parse({ ...process.env, LLM_MONTHLY_TOKEN_BUDGET: '-1' })).toThrow();
  });

  it('LLM_RECAP_MAX_MOMENTS < 1 被拒', () => {
    expect(() => envSchema.parse({ ...process.env, LLM_RECAP_MAX_MOMENTS: '0' })).toThrow();
  });

  it('字符串数字 coerce 成 number', () => {
    const cfg = envSchema.parse({ ...process.env, LLM_RECAP_MAX_MOMENTS: '50' });
    expect(cfg.LLM_RECAP_MAX_MOMENTS).toBe(50);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/config.test.ts`
Expected: FAIL（TDD 红灯）。`config.ts` 尚未加 `LLM_*` 字段、未导出 `envSchema`，`import { config, envSchema }` 后 `config.LLM_BASE_URL` 访问不存在的属性 → TS 编译错误（Property 'LLM_BASE_URL' does not exist on type '{...}'）或运行时 undefined 断言失败；`envSchema` 不存在导出 → `Cannot find name 'envSchema'`。两个 describe 都无法编译通过。

- [ ] **Step 3: 修改 config.ts 加 LLM_* 字段 + 导出 envSchema**

Modify `apps/server/src/config.ts`：
1. 把现有的 `const envSchema = z.object({...})` 改为 `export const envSchema = z.object({...})`（新增小 API 导出，供测试边界校验直接复用真实 schema 本体，无需在测试里同构副本）。这是 config 模块新增的唯一对外导出，业务代码不消费。
2. 在 `envSchema` 的 `MOMENT_E2E_VIEWER_PASSWORD` 字段之后、闭合 `})` 之前追加：
```ts
  // ---------- AI 月度回顾 LLM（spec §3） ----------
  // OpenAI 兼容端点（DeepSeek/通义/Moonshot 同一协议，环境变量切换）
  LLM_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  // 凭据；空串 = recap 管线整体停用（本地开发默认不配置，扫描照常但跳过派发，spec §3/§8）
  LLM_API_KEY: z.string().default(''),
  // 模型名
  LLM_MODEL: z.string().default('deepseek-chat'),
  // 全局月度 token 预算，默认 0 = 不限；超限走降级（spec §5）
  LLM_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),
  // 生成调度时区，默认 Asia/Shanghai（spec §1）
  LLM_RECAP_TZ: z.string().default('Asia/Shanghai'),
  // 输入截断护栏（spec §4）
  LLM_RECAP_MAX_MOMENTS: z.coerce.number().int().min(1).default(100),
  LLM_RECAP_MAX_CHARS: z.coerce.number().int().min(1).default(8000),
```

- [ ] **Step 4: 同步 .env.example**

Modify `apps/server/.env.example` — 在 `MOMENT_E2E_VIEWER_PASSWORD=` 行之后、`# 备份 sidecar` 注释之前追加：
```env

# AI 月度回顾 LLM（spec §3）
# OpenAI 兼容端点：DeepSeek/通义/Moonshot 同一协议，环境变量切换
LLM_BASE_URL=https://api.deepseek.com/v1
# 凭据；空 = recap 管线整体停用（本地开发默认不配置，扫描照常但跳过派发）
# 注意：moment 内容会出域到第三方 LLM，隐私敏感部署请留空（spec §8）
LLM_API_KEY=
LLM_MODEL=deepseek-chat
# 全局月度 token 预算，默认 0 = 不限；超限走降级（spec §5）
LLM_MONTHLY_TOKEN_BUDGET=0
# 生成调度时区（spec §1：每月1号按此时区判定）
LLM_RECAP_TZ=Asia/Shanghai
# 输入截断护栏（spec §4）
LLM_RECAP_MAX_MOMENTS=100
LLM_RECAP_MAX_CHARS=8000
```

- [ ] **Step 5: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/llm/config.test.ts
pnpm --filter @moment/server typecheck
```
Expected: 测试 PASS，2 个 describe 共 5 个 it（默认值 1 个 it 含 7 断言；边界拒绝 4 个 it）全过；typecheck exit 0（`config` 类型含新增字段、`envSchema` 已导出）。

- [ ] **Step 6: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有全部测试 + 新增 5 个 it 全绿（config 改动不得引起回归——新增字段有默认值，缺失 env 不报错）。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/config.ts apps/server/.env.example apps/server/tests/llm/config.test.ts
git commit -m "feat(server): add LLM config schema and env example"
```

---

### Task 2: LLMProvider 接口 + 错误类 + OpenAICompatProvider + factory 单例

**Files:**
- Create: `apps/server/src/llm/base.provider.ts`、`apps/server/src/llm/openai-compat.provider.ts`、`apps/server/src/llm/factory.ts`
- Test: `apps/server/tests/llm/provider.test.ts`、`apps/server/tests/llm/factory.test.ts`

**Interfaces:**
- Consumes: `config`（Task 1 的 `LLM_*` 字段）；Node 内置 `globalThis.fetch` / `AbortController`。
- Produces:
  - `interface LLMProvider { chat(req: LLMChatRequest): Promise<LLMChatResponse> }`（`base.provider.ts` 定义，T3 generate 与 T4 handler 消费）
  - `interface LLMChatRequest`（`base.provider.ts` 定义，`LLMProvider.chat` 入参：`{ messages: { role: 'system'|'user'; content: string }[]; maxTokens?: number; temperature?: number }`，T3 generate 消费）
  - `interface LLMChatResponse`（`base.provider.ts` 定义，`LLMProvider.chat` 出参：`{ content: string; model: string; usage: { prompt: number; completion: number; total: number } }`，T3 generate 消费，`usage` 透传到 `recaps.token_usage`）
  - `class OpenAICompatProvider implements LLMProvider`（构造注入 `{ baseUrl, apiKey, model, timeoutMs }`）
  - `getLLMProvider(): LLMProvider | null`（factory 单例；`LLM_API_KEY` 为空返回 null）
  - `setLLMProvider(p: LLMProvider | null | undefined): void`（测试注入点，与 `push/factory.ts` 的 `setPushService` 同范式；传 `undefined` 重置回真实 config 行为，`null`/provider 为注入值；严禁业务代码使用）
  - `class RetryableLLMError extends Error`（`name = 'RetryableLLMError'`）
  - `class NonRetryableLLMError extends Error`（`name = 'NonRetryableLLMError'`，携带 `statusCode: number`）

- [ ] **Step 1: 写失败测试 — provider 重试分类与响应解析**

Create `apps/server/tests/llm/provider.test.ts`（纯单测，不触库，mock `globalThis.fetch`）：
```ts
import {
  OpenAICompatProvider,
  RetryableLLMError,
  NonRetryableLLMError,
} from '../../src/llm/openai-compat.provider.js';

/** mock fetch 工厂：返回指定 status + body 的 Response */
function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

/** mock fetch 抛网络错误 */
function mockFetchNetworkError(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed: ECONNREFUSED');
  }) as typeof fetch;
}

/** mock fetch 永不 resolve（模拟超时） */
function mockFetchHang(): typeof fetch {
  return (async () => new Promise(() => {})) as typeof fetch;
}

const baseOpts = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  timeoutMs: 100, // 测试用短超时
};

const messages = [{ role: 'user' as const, content: '你好' }];

describe('OpenAICompatProvider.chat — 成功路径', () => {
  it('解析 choices[0].message.content + model + usage', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: '你好！' } }],
      model: 'deepseek-chat-001',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      const result = await provider.chat({ messages });
      expect(result.content).toBe('你好！');
      expect(result.model).toBe('deepseek-chat-001');
      expect(result.usage).toEqual({ prompt: 10, completion: 5, total: 15 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('maxTokens/temperature 透传到 body', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: unknown;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await provider.chat({ messages, maxTokens: 2048, temperature: 0.3 });
      const body = capturedBody as Record<string, unknown>;
      expect(body['max_tokens']).toBe(2048);
      expect(body['temperature']).toBe(0.3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('URL 拼接 baseUrl + /chat/completions', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await provider.chat({ messages });
      expect(capturedUrl!).toBe('https://api.deepseek.com/v1/chat/completions');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Authorization header 携带 Bearer apiKey', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init!.headers);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await provider.chat({ messages });
      expect(capturedHeaders!.get('authorization')).toBe('Bearer sk-test');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('OpenAICompatProvider.chat — 错误分类', () => {
  it('429 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(429, { error: { message: 'rate limit' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('500 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(500, { error: { message: 'server error' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('503 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(503, { error: { message: 'unavailable' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('400 → NonRetryableLLMError（含 statusCode）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(400, { error: { message: 'bad request' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toMatchObject({
        name: 'NonRetryableLLMError',
        statusCode: 400,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('401 → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(401, { error: { message: 'unauthorized' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toMatchObject({
        name: 'NonRetryableLLMError',
        statusCode: 401,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('网络错误 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchNetworkError();
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('超时 → RetryableLLMError（AbortController 60s 默认 / 测试用 100ms）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchHang();
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('响应体缺 choices → NonRetryableLLMError（422 等畸形响应走不可重试）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(422, { error: { message: 'malformed' } });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('200 但 choices 为空 → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { choices: [], model: 'm', usage: {} });
    try {
      const provider = new OpenAICompatProvider(baseOpts);
      await expect(provider.chat({ messages })).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/provider.test.ts`
Expected: FAIL，模块不存在（`Cannot find module '../../src/llm/openai-compat.provider.js'`）。

- [ ] **Step 3: 实现 base.provider.ts（接口 + 错误类）**

Create `apps/server/src/llm/base.provider.ts`：
```ts
/**
 * LLM Provider 接口（spec §3）。
 * 与 storage adapter（CONVENTIONS §3.3）同范式：接口 + 默认实现 + factory 单例。
 * 调用方（T3 generateRecap）通过依赖注入接收 provider，测试用 mock provider 注入。
 */
export interface LLMChatRequest {
  messages: { role: 'system' | 'user'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMChatResponse {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
}

export interface LLMProvider {
  chat(req: LLMChatRequest): Promise<LLMChatResponse>;
}

/**
 * 可重试错误（spec §3：429/5xx/网络/超时）。
 * outbox handler（T4）捕获此类错误时走指数退避重试。
 */
export class RetryableLLMError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableLLMError';
  }
}

/**
 * 不可重试错误（spec §3：4xx 其他）。
 * outbox handler（T4）捕获此类错误时直接标记 failed，不重试。
 */
export class NonRetryableLLMError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'NonRetryableLLMError';
  }
}
```

- [ ] **Step 4: 实现 openai-compat.provider.ts**

Create `apps/server/src/llm/openai-compat.provider.ts`：
```ts
import type { LLMChatRequest, LLMChatResponse, LLMProvider } from './base.provider.js';
import { NonRetryableLLMError, RetryableLLMError } from './base.provider.js';

export interface OpenAICompatProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求超时毫秒，默认 60000（spec §3） */
  timeoutMs?: number;
}

/**
 * OpenAI 兼容 chat/completions 实现（spec §3）。
 * 支持 DeepSeek/通义/Moonshot 等 OpenAI 协议兼容端点。
 * POST {baseUrl}/chat/completions，Bearer apiKey，body 带 model。
 * 错误分类：429/5xx/网络/超时 → RetryableLLMError；4xx 其他 → NonRetryableLLMError。
 */
export class OpenAICompatProvider implements LLMProvider {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAICompatProviderOptions) {
    // baseUrl 末尾可能带 / 也可能不带，统一拼接
    const base = opts.baseUrl.endsWith('/') ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
    this.url = `${base}/chat/completions`;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async chat(req: LLMChatRequest): Promise<LLMChatResponse> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: req.messages,
    };
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError（超时）或网络错误（ECONNREFUSED 等）都是可重试的
      clearTimeout(timer);
      throw new RetryableLLMError(
        err instanceof Error && err.name === 'AbortError'
          ? `LLM request timed out after ${this.timeoutMs}ms`
          : `LLM network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    // 429/5xx → RetryableLLMError
    if (resp.status === 429 || resp.status >= 500) {
      const errBody = await safeJson(resp);
      throw new RetryableLLMError(
        `LLM ${resp.status}: ${errBody?.error?.message ?? resp.statusText}`,
      );
    }

    // 4xx 其他 → NonRetryableLLMError
    if (resp.status >= 400) {
      const errBody = await safeJson(resp);
      throw new NonRetryableLLMError(
        `LLM ${resp.status}: ${errBody?.error?.message ?? resp.statusText}`,
        resp.status,
      );
    }

    // 200 但 choices 缺失/空 → NonRetryableLLMError（畸形响应，不重试）
    const data = await safeJson(resp);
    if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
      throw new NonRetryableLLMError(
        'LLM response missing choices array',
        resp.status,
      );
    }

    const choice = data.choices[0] as { message?: { content?: string } };
    const content = choice.message?.content;
    if (typeof content !== 'string') {
      throw new NonRetryableLLMError(
        'LLM response missing message.content',
        resp.status,
      );
    }

    const usage = data.usage ?? {};
    return {
      content,
      model: typeof data.model === 'string' ? data.model : this.opts.model,
      usage: {
        prompt: Number(usage.prompt_tokens ?? 0),
        completion: Number(usage.completion_tokens ?? 0),
        total: Number(usage.total_tokens ?? 0),
      },
    };
  }
}

/** 安全解析 JSON 响应体，失败返回 null */
async function safeJson(resp: Response): Promise<any | null> {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/llm/provider.test.ts`
Expected: PASS，13 个测试全过（成功路径 4 + 错误分类 9）。

- [ ] **Step 6: 写失败测试 — factory 单例与空 key 返回 null**

Create `apps/server/tests/llm/factory.test.ts`（纯单测，不触库）。用 `setLLMProvider` 注入点强制覆盖两个分支（H2 三态修好后可重置，`afterEach` 清理防止 `--runInBand` 下跨文件状态污染）：
```ts
import { getLLMProvider, setLLMProvider } from '../../src/llm/factory.js';
import { OpenAICompatProvider } from '../../src/llm/openai-compat.provider.js';

describe('getLLMProvider', () => {
  afterEach(() => setLLMProvider(undefined)); // 重置回真实 config 行为（H2 三态：undefined=回落 singleton）

  it('注入 mock provider → 返回该 mock（单例缓存）', () => {
    const mock = { chat: jest.fn() };
    setLLMProvider(mock as any);
    expect(getLLMProvider()).toBe(mock);
    expect(getLLMProvider()).toBe(mock); // 同一实例
  });

  it('注入 null → 返回 null（模拟空 key 停用）', () => {
    setLLMProvider(null);
    expect(getLLMProvider()).toBeNull();
  });

  it('重置(undefined) → 回落真实 config：空 key 环境返回 null', () => {
    setLLMProvider(undefined);
    // 测试库 env 默认无 LLM_API_KEY
    const provider = getLLMProvider();
    expect(provider === null || provider instanceof OpenAICompatProvider).toBe(true);
    // 不依赖 env 是否配 key，两种合法结果都接受；重点是重置后回落真实而非注入值
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/llm/factory.test.ts`
Expected: FAIL，`Cannot find module '../../src/llm/factory.js'`。

- [ ] **Step 8: 实现 factory.ts**

Create `apps/server/src/llm/factory.ts`（三态范式，对齐 `push/factory.ts` 的 `singleton` + `override` 双变量结构。LLM factory 返回 `LLMProvider | null`，null 是合法计算值（空 key），不能用 null 作 override 的 falsy 回落，故采用 undefined/三态）：
```ts
import { config } from '../config.js';
import type { LLMProvider } from './base.provider.js';
import { OpenAICompatProvider } from './openai-compat.provider.js';

// 三态语义（对齐 push/factory.ts 的 singleton + override 范式，但 null 是合法计算值，故用 undefined 区分「未求值/无注入」）：
//   singleton: undefined=未求值; null=已求值且空 key; provider=已求值且有 key
//   override:  undefined=无注入（回落真实 config 行为）; null|provider=注入值
let singleton: LLMProvider | null | undefined;
let override: LLMProvider | null | undefined;

/**
 * LLM provider factory 单例（spec §3）。
 * LLM_API_KEY 为空 → 返回 null（recap 管线整体停用，扫描照常但跳过派发，spec §3/§8）。
 * 有 key → 返回 OpenAICompatProvider 单例。
 */
export function getLLMProvider(): LLMProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = config.LLM_API_KEY
      ? new OpenAICompatProvider({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY, model: config.LLM_MODEL })
      : null;
  }
  return singleton;
}

/** 测试注入点（与 push/factory.ts 的 setPushService 同范式）。传 undefined 重置回真实 config 行为；严禁业务代码使用。 */
export function setLLMProvider(p: LLMProvider | null | undefined): void {
  override = p;
}
```

- [ ] **Step 9: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/llm/`
Expected: PASS，全部测试通过（config 5 + provider 13 + factory 3）。

- [ ] **Step 10: 全量回归 + typecheck + lint**

Run:
```bash
pnpm --filter @moment/server test
pnpm --filter @moment/server typecheck
pnpm --filter @moment/server lint
```
Expected: 全部 exit 0；测试总数 = 既有 + 21。

- [ ] **Step 11: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/llm/ apps/server/tests/llm/
git commit -m "feat(server): add LLM provider abstraction with OpenAI-compatible implementation"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全绿（既有 + 21 个新增：config 5 + provider 13 + factory 3）
- [ ] `pnpm --filter @moment/server typecheck` exit 0
- [ ] `pnpm --filter @moment/server lint` exit 0
- [ ] spec §3 的 `LLMProvider` 接口、OpenAI 兼容实现（Bearer auth / model / max_tokens / temperature / 超时 60s / 错误分类）逐一落实
- [ ] `config.ts` 新增 7 个 `LLM_*` 字段与 `.env.example` 同步，且 `export const envSchema` 供测试边界校验
- [ ] 执行 prompt T2 的 Produces 符号逐个可解析：`LLMProvider` / `LLMChatRequest` / `LLMChatResponse` / `OpenAICompatProvider` / `getLLMProvider` / `setLLMProvider` / `RetryableLLMError` / `NonRetryableLLMError`（携带 `statusCode: number`）
- [ ] 空 key → `getLLMProvider()` 返回 null（recap 管线停用开关可用）；`setLLMProvider` 注入点可重置（三态 undefined 回落真实）
