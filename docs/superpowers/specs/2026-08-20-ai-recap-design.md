# 时刻 Moment — AI 月度回顾 Design

> 日期：2026-08-20
> 状态：已实现（P1–P7 合入，2026-08-21）
> 范围：server（llm 模块 + recap 管线）+ dto + api-client + web + app + 分享页
> 权威边界：数据模型与异步机制以 `2026-08-15-moment-design.md`（outbox/worker/通知扇出）为准；模板结构化素材（kind/payload）以 `2026-08-20-chain-templates-design.md` 为准。本 spec 不修改媒体与权限语义。

## 0. 产品决策（已与用户对齐）

- 记录类产品的死因是回报后置。**AI 月度回顾把回报前置**：每月初自动生成上月回顾，推送全家，不用用户做任何事。
- v1 **纯文本输入**（moment 正文 + kind/payload 摘要 + 精选评论），成本与延迟可控；接口预留视觉理解（mediaRefs），v2 接入时不动接口。
- LLM 接**抽象 provider 层**，默认 OpenAI 兼容协议（DeepSeek/通义/Moonshot 同一协议，环境变量切换）。
- 回顾与模板互相成就：模板供给结构化素材（里程碑、身高体重、心情），回顾让结构化记录产生情感回报。**回顾 v1 不强依赖模板**（纯文本 moment 也能跑），实施顺序模板先行、回顾紧跟。

## 1. 数据流

```
worker 定时扫描（每月 1 号）
  → 找出「上月有活动」的链（上月存在未软删 moment）
  → 逐链写 outbox 行（type = recap_generate，payload = {chain_id, period}）
  → outbox 消费者：组装输入（§4）→ 调 LLMProvider（§3）→ upsert recaps 行
  → 成功：写第二条 outbox（type = notify，type=recap_ready 的通知扇出 + Expo Push，复用现有管线）
  → 失败：指数退避重试（复用 outbox attempts/next_retry_at），终败落 status=failed
```

- 全部副作用在 worker，请求路径零新增开销（与主 spec §5.4 一致）。
- 定时扫描：worker 内置调度循环（每小时检查一次「当前是否为生成窗口且该 period 尚未派发」），幂等靠 `recaps` 的 `UNIQUE(chain_id, period)` + outbox 去重键（payload 唯一性检查）。

**生成时区**：「每月 1 号」按固定产品时区 `LLM_RECAP_TZ`（默认 `Asia/Shanghai`）判定。理由：目标用户是中国家庭，按每成员本地时区判定在 v1 是过度设计；跨时区家庭的 period 边界最多偏半天，回顾内容不受影响（period 按链内 moment 的 `wall_date` 归属月份统计，与查看者时区无关）。

## 2. 数据模型

### 新表 `recaps`

| 列 | 说明 |
|---|---|
| id | 主键 |
| chain_id | 所属链 |
| period | `char(7)`，`YYYY-MM`，按 wall_date 归属月 |
| status | enum(`generating`,`ready`,`failed`,`degraded`) —— `degraded` = 预算超限降级为模板文案（§5） |
| content | text，Markdown 正文 |
| highlights | json，引用的 moment id 有序列表（客户端渲染「高光时刻」跳转） |
| model | 实际使用的模型名（审计） |
| prompt_version | int，prompt 模板版本（重生成对比用） |
| token_usage | json `{prompt, completion, total}`（成本核算） |
| error | text NULL，failed 时的摘要 |
| generated_at / created_at / updated_at | |

- `UNIQUE(chain_id, period)`；**重生成 = upsert**（覆盖 content/highlights/status，保留 created_at）。
- 索引：`(chain_id, period DESC)` 已由唯一索引覆盖；worker 扫描用 `(status)` 无必要（扫描走 moments 表找活跃链）。
- 软删链的 recaps 随链硬删级联（链删除是硬删语义，recaps FK ON DELETE CASCADE）。

### `chains` 表变更

- `share_recaps_enabled boolean NOT NULL DEFAULT true` —— 链级开关：分享只读页是否外发最近一期 ready 回顾（§6）。默认开（长辈收到本月回顾是最强回访钩子），owner 可在链设置关闭。
- 迁移：`ADD COLUMN share_recaps_enabled boolean NOT NULL DEFAULT true`，纯加列有默认值，一步到位，无回填；回滚 = drop column，无损。

### 迁移与回滚

`recaps` 为单表新增（含唯一索引），无存量数据回填；回滚 = drop table，无损。`chains` 加列同上，两部分可同批迁移。

## 3. LLM Provider 抽象

与 storage adapter（主 spec §5.3）同范式：

```
apps/server/src/llm/
├── base.provider.ts      # LLMProvider 接口
├── openai-compat.provider.ts  # 默认实现：OpenAI 兼容 chat/completions
├── factory.ts            # 按 config 创建
└── recap/
    ├── input.ts          # RecapInput 组装（§4）
    ├── prompt.ts         # prompt 模板 + PROMPT_VERSION
    └── generate.ts       # 编排：组装→调用→解析→落库
```

```ts
interface LLMProvider {
  chat(req: {
    messages: { role: 'system' | 'user'; content: string }[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ content: string; model: string; usage: { prompt: number; completion: number; total: number } }>;
}
```

- 默认实现：POST `{LLM_BASE_URL}/chat/completions`，Bearer `LLM_API_KEY`，body 带 `model`。超时 60s，失败抛可重试错误（429/5xx/网络）与不可重试错误（4xx 其他）分类。
- **视觉预留**：`RecapInput` 类型含 `mediaRefs?: { media_id: number; kind: 'image' }[]`，v1 恒为空数组；v2 由 provider 实现决定如何转多模态 message，接口不变。

### 新环境变量（同步 `config.ts` zod + `.env.example`）

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` | OpenAI 兼容端点（如 `https://api.deepseek.com/v1`） |
| `LLM_API_KEY` | 凭据；**空 = recap 管线整体停用**（本地开发默认不配置，扫描照常跑但跳过派发） |
| `LLM_MODEL` | 模型名（如 `deepseek-chat`） |
| `LLM_MONTHLY_TOKEN_BUDGET` | 全局月度 token 预算，默认 0 = 不限；超限走降级（§5） |
| `LLM_RECAP_TZ` | 生成调度时区，默认 `Asia/Shanghai` |
| `LLM_RECAP_MAX_MOMENTS` / `LLM_RECAP_MAX_CHARS` | 输入截断护栏，默认 100 / 8000 |

## 4. 输入组装（v1 纯文本）

对给定 (chain, period)：

1. 取该链 `wall_date` 落在 period 内的未软删 moments，按 `happened_at` 正序。
2. 每条序列化为一行：`[MM-DD HH:mm] {作者昵称}` + 正文摘要 + kind 标记 + payload 摘要：
   - `milestone` → `【里程碑】{label}`；`metric` → `【记录】身高 62cm`；`mood` → `【心情】😄`；`geo` → `【位置】{place_name}`。
3. 精选评论：每 moment 最多 2 条、每条 ≤100 字，附在所属 moment 下。
4. **截断护栏**：超过 `LLM_RECAP_MAX_MOMENTS` 按「有 payload 的结构化记录优先，其次按评论数」排序截取；总字符超 `LLM_RECAP_MAX_CHARS` 二次截断。截断发生时在 prompt 中声明条数。
5. 结构化输出：system prompt 要求返回 JSON `{content: markdown, highlight_moment_ids: number[]}`；解析失败重试一次，再失败按 failed 处理。`highlight_moment_ids` 过滤掉不属于该链该月的 id（模型幻觉防线）。

baby 模板额外注入：宝宝 `birthdate` 换算的月龄（「本期末 1 岁 2 个月」），让回顾能写出年龄叙事。

## 5. 成本护栏与降级

- **频率**：每链每月至多一次自动生成（UNIQUE 约束兜底）；手动重生成见 §6，每日每链限 3 次（editor+）。
- **预算**：worker 维护当月全局 token 消耗（`SUM(token_usage.total)` 按 generated_at 月聚合）；超 `LLM_MONTHLY_TOKEN_BUDGET` 后，新派发走**降级路径**：不调 LLM，用规则模板拼文案（结构化数据直出：「本月记录 N 条，里程碑：……」），`status=degraded`。降级回顾同样推送，文案如实标注非 AI 生成。
- **失败**：LLM 调用失败走 outbox 指数退避；终败 `status=failed`，不推送（避免打扰），下月扫描不补跑（period 已过）。
- **用量审计**：`model`/`prompt_version`/`token_usage` 全部落表。

## 6. API 设计

- `GET /chains/:id/recaps` —— 该链回顾列表（period 倒序，成员可读，含 viewer）。
- `GET /chains/:id/recaps/:period` —— 单条详情（`period` 格式 `YYYY-MM`，zod 校验，非法 → `INVALID_PERIOD`）。
- `POST /chains/:id/recaps/:period/regenerate` —— editor+，仅允许已存在的 period（该月有记录），写 outbox 重生成；每日每链限 3 次 → `RECAP_REGENERATE_LIMIT`。
- 分享页：`GET /public/share/:token` 响应附最近一期 `ready`/`degraded` 回顾（含 degraded，§5 降级回顾同样外发；`share_recaps_enabled` 链级开关，**默认开**——长辈收到本月回顾是最强回访钩子；owner 可在链设置关闭）。`generating`/`failed` 不外发。
- 通知：`type=recap_ready`，payload 含链名与 period 快照（链改名后通知文案不回溯，与现有快照语义一致）；点击进链内 recap 页。链免打扰预留与主 spec 一致。

## 7. 各端 UX

- 时间线顶部入口条：存在最近一期 ready/degraded 回顾时渲染（与那年今日入口条同模式），点击进入链内 recap 页。
- recap 页：Markdown 正文 + 「高光时刻」区（highlights 引用的 moments 卡片，点击跳转详情）。
- 推送文案：「『宝宝成长』的 7 月回顾出炉了」。
- 分享页只读展示，无评论入口（匿名不可评论的既有约束不变）。

## 8. 隐私与安全

- moment 内容出域到第三方 LLM：`.env.example` 与部署文档显式声明此行为；`LLM_API_KEY` 为空即全功能停用（自托管/隐私敏感部署的开关）。
- prompt 不含成员邮箱等 PII（只传昵称）；媒体 URL 不进 prompt（v1 纯文本天然满足）。
- recap 内容权限 = 链内容权限（成员可读、viewer 可读、分享页受开关控制），无新增权限维度。

## 9. 测试策略

- `RecapInput` 组装：截断护栏（条数/字符）、payload 摘要序列化、幻觉 id 过滤（单测，mock provider）。
- provider：OpenAI 兼容实现的重试分类（429/5xx 可重试，4xx 不可）、超时（msw/nock mock）。
- outbox 管线：派发幂等（重复扫描不产生重复 outbox 行）、重生成 upsert、`recap_ready` 通知扇出。
- 预算降级：超限后 status=degraded、不调 provider。
- 权限：viewer 可读、非成员 403、分享页开关关闭时不外发。
- 夹具：`insertRecap` helper；`resetDb()` 补 recaps 表（在 moments 之前删，注意 FK 顺序）。

## 10. 容量假设与演进路径

| 假设 | 演进触发 |
|---|---|
| 活跃链每月数千级，单 worker 可消化 | outbox 已有重试；量大换多 worker（主 spec 已有此演进项） |
| v1 纯文本 | v2 视觉理解：填 mediaRefs + provider 多模态实现，接口不变 |
| 月度单一频率 | 周报/年度回顾：period 泛化为 `{type, key}`，表结构加列演进 |
| 模板文案降级 | 本地小模型（Ollama）provider 实现，接口不变 |

## 11. 实施分期

1. server：llm 模块（接口 + OpenAI 兼容实现 + factory）+ config/.env.example。
2. server：recaps 表 + 输入组装 + outbox 派发/消费 + 预算降级。
3. dto/api-client：Recap 类型与端点。
4. server：通知扇出 + 分享页开关与外发。
5. web：入口条 + recap 页 + 高光跳转 + 分享页展示。
6. app：同 web。
7. e2e：整链路（造数据 → 手动触发派发 → 断言落库与通知）。
