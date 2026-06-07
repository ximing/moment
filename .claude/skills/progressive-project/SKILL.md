---
name: progressive-project
description: 把现有项目重构为适合 Claude Code、Codex CLI 或 CatPaw IDE 的持久化指令渐进式加载架构。用户提到“拆分根 CLAUDE.md”、“按目录下沉规则”、“给当前项目设计分层指令文件”、“创建不同目录的 CLAUDE.md”、“补 `.claude/rules` / `.catpaw/rules`”、“配置 Codex 读 CLAUDE.md / AGENTS.md”、“设置 project_doc_fallback_filenames”、“把仓库改造成渐进式加载”时使用。技能默认不仅解释加载机制，还会基于仓库结构直接设计并落地最合适的指令文件布局。
---

# 渐进式项目指令架构

## 目的

本技能不是单纯解释 Claude Code 如何加载指令。

本技能的默认目标是：

1. 识别当前仓库的结构与目录职责
2. 判断哪些规则应该放在根级、目录级、路径级
3. 将项目重构为最合适的渐进式加载架构
4. 创建或改写合适的 `CLAUDE.md`、嵌套 `CLAUDE.md`、`.claude/rules/*.md`、`.catpaw/rules/*.md`，确保两套规则体系各自字段正确且语义一致
5. 让 Codex CLI 通过回退文件名复用同一套 `CLAUDE.md` 目录链，不制造第二真相源

如果仓库可访问，默认直接分析并改文件，而不是只停留在解释层。

## 适用场景

以下请求应直接使用本技能：

- “帮我把当前项目改成渐进式加载”
- “这个仓库怎么拆 CLAUDE.md 才合理”
- “根据目录职责生成不同的 CLAUDE.md”
- “帮我补 `.claude/rules` / `.catpaw/rules`”
- “根规则太大了，帮我下沉到子目录”
- “想让 Claude 进入不同目录时加载不同约束”
- "请根据 Claude Code 的持久化指令机制重构项目规则"
- "帮我补 `.catpaw/rules` 的 Auto Attached 规则"
- "让 CatPaw IDE 和 Claude Code 都能用上分层规则"
- “让 Codex 也能读到我的 CLAUDE.md / 分层规则”
- “配置 Codex 的 AGENTS.md / project_doc_fallback_filenames”
- “给 Codex 写 AGENTS.md，但不想和 CLAUDE.md 维护两份”

## 成功标准

完成后应满足：

- 根 `CLAUDE.md` 足够精简，只保留全局基线
- 子目录规则只在进入对应区域时加载
- 跨目录但可按文件模式命中的规则放到 `.claude/rules/*.md` 并带 `paths`，同步到 `.catpaw/rules/*.md` 并带兼容 CatPaw 的 frontmatter
- 不为每个目录机械生成规则，只覆盖真正有语义边界的区域
- 现有规则体系没有被打散成多个互相冲突的真相源
- `.claude/rules/*.md` 与 `.catpaw/rules/*.md` 必须保持完全相同的正文内容，只允许 frontmatter 格式不同
- CatPaw 的 `globs` 与 `paths` 使用同一组标准 glob 路径表达式，不能只写文件扩展名列表；两者应保持一致以避免作用域漂移
- 如果 Codex 也要使用本仓库：指令文件名二选一且全仓一致——全仓 `CLAUDE.md` + 回退名单，或全仓 `AGENTS.md`；不得混用，同目录不得并存语义不同的两套文件。关键横切规则不能只放在 `.claude/rules`（Codex 无对应加载机制）

## 加载模型速记

设计前先基于以下事实判断，不要偏离：

### Claude Code 加载机制

#### 启动时加载

Claude 会从当前工作目录向上加载可见的：

- `CLAUDE.md`
- `CLAUDE.local.md`
- `.claude/CLAUDE.md`
- `.claude/rules/` 中未被更窄作用域限制的内容

#### 按需加载

以下内容只有在 Claude 真正进入相关区域时才加载：

- 子目录中的 `CLAUDE.md`
- 带 `paths` 的 `.claude/rules/*.md`
- 更深层目录中的局部规则

#### 导入不是懒加载

如果根 `CLAUDE.md` 通过 `@...` 导入大段内容，被导入内容会跟着根文件一起进入上下文。

因此：

- `@...` 用于复用与维护
- 不要把它当成主要的渐进式加载机制

### CatPaw IDE 加载机制

CatPaw IDE 通过 `.catpaw/rules/*.md` 文件加载规则，使用 YAML frontmatter 控制加载行为。

#### frontmatter 字段说明

| 字段          | 必填     | 说明                                                                                               |
| ------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `ruleType`    | ✅       | 规则类型，决定何时加载。可选值：`Always`、`Auto Attached`、`Manual`、`Model Request`               |
| `description` | ❌       | 规则的简要描述，便于理解规则用途                                                                   |
| `globs`       | 条件必填 | 仅 `ruleType: Auto Attached` 时必填。指定匹配的文件路径模式（如 `src/**/*.service.ts,src/**/index.tsx`），必须符合标准 glob 语法 |
| `paths`       | ❌       | 限制规则生效的目录范围；为避免歧义，推荐与 `globs` 保持完全一致 |

#### ruleType 与加载时机

| ruleType        | 加载时机                                         | 使用场景                                           |
| --------------- | ------------------------------------------------ | -------------------------------------------------- |
| `Always`        | 每次对话始终加载                                 | 全局基线规则，如项目结构、技术栈、常用命令         |
| `Auto Attached` | 编辑/查看匹配 `globs` + `paths` 的文件时按需加载 | 横切关注点，如测试规则、组件规范、API handler 约束 |
| `Manual`        | 用户手动选择加载                                 | 参考性规则，不常用但偶尔需要                       |
| `Model Request` | 模型主动请求加载                                 | 模型按需查询的深度参考                             |

#### CatPaw 与 Claude Code 字段映射

| Claude Code (`.claude/rules/*.md`) | CatPaw IDE (`.catpaw/rules/*.md`)             | 说明                                                      |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `paths` (frontmatter)              | `globs` + `paths` (frontmatter)               | CatPaw 推荐让 `globs` 与 `paths` 使用同一组路径 glob，确保匹配范围一致 |
| 无 frontmatter = 始终加载          | `ruleType: Always`                            | 全局规则 |
| 带 `paths` = 按需加载              | `ruleType: Auto Attached` + `globs` + `paths` | 横切规则 |
| —                                  | `ruleType: Manual` / `Model Request`          | CatPaw 独有，Claude Code 无对应 |

**注意**：CatPaw 的 `globs` 与 `paths` 都应使用标准 glob 路径表达式。对于同一条 Auto Attached 规则，推荐两者保持一致，例如：`globs: src/**/*.service.ts,src/**/index.tsx`，并在 `paths` 中列出同样的条目。

### Codex CLI 加载机制

Codex **没有** `.claude/rules` 那种按 glob 按需加载的路径级规则文件。它的渐进式披露完全依赖 `AGENTS.md` 目录链。

**警惕混淆**：`~/.codex/rules/*.rules` 和 `<repo>/.codex/rules/*.rules` 是 Starlark 编写的**命令执行策略**（`prefix_rule` 的 allow/prompt/forbidden），管的是沙箱外命令放行，与指令加载无关。不要把 Markdown 规则放进 `.rules`，也不要指望它实现渐进式披露。

#### 启动时构建指令链（每次运行一次）

全局层：`~/.codex/`（可用 `CODEX_HOME` 覆盖）下先读 `AGENTS.override.md`，不存在则读 `AGENTS.md`，只取该层第一个非空文件。

项目层：从项目根（通常是 git 根）沿目录树**向下走到当前工作目录**，每个目录按顺序检查：

1. `AGENTS.override.md`
2. `AGENTS.md`
3. `project_doc_fallback_filenames` 中的回退文件名

每个目录**至多取一个文件**（同目录存在 override 时，`AGENTS.md` 与回退文件都被忽略）。

项目根由 `project_root_markers` 决定（默认 `.git`）；找不到项目根时只检查当前目录。

合并规则：从根到 cwd 逐级拼接、空行分隔，越靠近 cwd 的文件越靠后，因此**深层覆盖浅层**。项目链合并总大小受 `project_doc_max_bytes` 限制（默认 32 KiB），超限截断（最深层的规则先被截掉），空文件跳过；全局层文件走独立通道，**不占**这 32 KiB 预算。

#### 与 Claude Code 的关键行为差异

| 行为 | Claude Code | Codex CLI |
| --- | --- | --- |
| 嵌套指令加载时机 | 会话中真正进入子目录/读取该子树文件时懒加载 | 仅启动时构建 root→cwd 链，会话中不再动态加载 |
| 目录级文件名 | `CLAUDE.md` | `AGENTS.md` / `AGENTS.override.md`（可通过回退名单复用 `CLAUDE.md`） |
| 多级合并 | 所有层级同时生效，子级补充父级 | root→cwd 全链拼接，深层覆盖浅层；每目录至多一个文件 |
| 路径级（glob）规则 | `.claude/rules/*.md` + `paths` | 无对应机制（`.rules` 是命令策略，不是指令） |
| 合并大小上限 | 无硬性合并上限 | 默认 32 KiB（`project_doc_max_bytes`） |
| 用户个人规则 | `CLAUDE.local.md` | 不读取（排进回退名单也会被同目录更优先的 `CLAUDE.md` 遮蔽，实际不可行） |

推论：在仓库根启动 Codex 时，子目录的指令文件**不会**进入指令链——只有从该子树内启动（或 `--cd` 进去）才会加载。给 Codex 设计分层时，这是与 Claude Code 懒加载最大的差异。

#### 与 Claude Code 共存的单一真相源策略

推荐让 Codex 通过回退名单直接复用既有 `CLAUDE.md` 目录链：

```toml
project_doc_fallback_filenames = ["CLAUDE.md"]
```

配置位置二选一：

- 用户级 `~/.codex/config.toml`：对本机所有仓库生效。**写入前必须向用户确认**——它会改变本机每个仓库的 Codex 指令发现行为。
- 仓库级 `.codex/config.toml`：随仓库分发，团队成员无需各自配置，但只在**信任（trust）该项目 `.codex/` 层**后才生效。优先推荐这个位置。

要点：

- 回退检查发生在每个目录层级：某目录只要有 `AGENTS.md` 或 `AGENTS.override.md`，同目录的 `CLAUDE.md` 就被 Codex 忽略。因此**不要**部分目录用 `AGENTS.md`、部分用 `CLAUDE.md` 混用——那会造成两套真相源。选一种：全仓 `CLAUDE.md` + 回退名单（推荐，Claude 优先仓库），或全仓 `AGENTS.md` 并让根目录 `CLAUDE.md` 只做指针。
- 回退名单是**按序检查、命中即止**（每目录至多取一个文件）：`project_doc_fallback_filenames = ["CLAUDE.md", "TEAM_GUIDE.md"]` 时，某目录有 `CLAUDE.md` 就不再看 `TEAM_GUIDE.md`。
- 仓库中已存在的 `AGENTS.md` 是跨工具开放标准（Amp、Jules、Cursor 等同样消费它），**默认保留，处置方式（合并/改名/删除）必须先向用户确认**，不要因为"不得并存"就直接删。
- `.claude/rules/*.md` 与 `CLAUDE.local.md` 不会被 Codex 加载。如果某条横切规则对 Codex 用户也关键，把它（或其摘要）下沉到最近目录的指令文件里；否则明确接受 Codex 看不到它。
- 临时全局覆盖用 `~/.codex/AGENTS.override.md`，删除即恢复，不动基础文件。
- 合并内容接近 32 KiB 时，优先精简根文件或拆分到子目录；确需调大时在 config.toml 写 `project_doc_max_bytes = 65536` 并重启 Codex。

#### Code Review Rules（GitHub 侧评审）

Codex code review（含 GitHub 集成）通过指令文件中的 `## Code Review Rules` 章节接收评审规则：仓库级检查放根文件，服务级检查放嵌套文件。**注意：GitHub 侧的 Codex code review 搜索的是仓库中的 `AGENTS.md` 文件**——纯"`CLAUDE.md` + 回退名单"策略下，远端评审能否读到规则没有保证。启用了 Codex GitHub code review 的仓库，应在根 `AGENTS.md`（或指针文件）中承载 `## Code Review Rules`，或在根指令文件中同步该章节。

#### 验证 Codex 加载

```bash
codex --ask-for-approval never "Summarize the current instructions."
codex --cd apps/web --ask-for-approval never "Show which instruction files are active."
```

预期：第一条按 全局 → 根 → cwd 顺序复述指令来源；第二条能看到 `apps/web` 层的文件。审计可用 `codex -c log_dir=./.codex-log` 后查 `codex-tui.log`。

排障：全局规则突然不加载时，先 `echo $CODEX_HOME`——非默认值说明 Codex 读的是另一个 home 目录。

## 设计原则

### 1. 根文件只放基线

根 `CLAUDE.md` 只放：

- 仓库级目标与架构概览
- 必须全局生效的工程约束
- 常用构建、测试、提交流程入口
- 指引性说明：更细规则分布在哪些区域

不要把包级、页面级、框架级细节堆在根文件。

### 2. 目录规则只为“稳定语义边界”服务

只有同时满足以下至少两项，才值得单独建局部 `CLAUDE.md`：

- 目录职责稳定
- 会被多人长期触达
- 对文件放置和实现方式有持续约束
- 与父目录相比有明确增量规则

### 3. 路径规则解决横切关注点

如果规则跨多个目录，但能用文件模式描述，就同时创建 `.claude/rules/*.md` 和 `.catpaw/rules/*.md`：

- `**/*.test.ts`
- `src/**/*.tsx`
- `packages/*/src/**/*.ts`
- `docs/**/*.md`

Claude Code 的规则文件必须带 `paths`；CatPaw 的规则文件必须设置 `ruleType: Auto Attached` 并填写 `globs` 和 `paths`，且推荐两者使用完全一致的 glob 集合，否则很容易出现作用域漂移或广泛加载。

Codex 没有 glob 路径规则的对应物：如果这条横切规则对 Codex 用户同样关键，必须把它（或其摘要）落到 glob 命中的那些文件所在目录的最近指令文件（`CLAUDE.md`，经回退名单命中）里，否则明确告知用户 Codex 不会加载它。

### 4. 不要制造两个真相源

优先沿用仓库现有约定：

- 如果仓库已经用 `CLAUDE.md` + `.claude/rules/*.md`，继续在这套体系内演进
- 如果仓库已经用 `.catpaw/rules/readme.md` 作为目录级真相源，并以 sibling `CLAUDE.md` 作为镜像，则继续沿用，不要额外再发明一套目录级来源
- 如果 Codex 也要用本仓库，默认策略是"全仓 `CLAUDE.md` + 回退名单"，而不是在每个目录并行维护一份内容雷同的 `AGENTS.md`
- `.claude/rules/*.md` 和 `.catpaw/rules/*.md` 应保持同名文件的正文内容完全一致，只允许 frontmatter 不同（Claude Code 用 `paths`，CatPaw 用兼容的 `ruleType` + `globs` + `paths`）
- 如果规则目录下已经存在以 `km-`、`km-web-`、`km-rn-` 为前缀的规则文件，将其视为既有通用知识资产：默认不改写、不迁移、不合并、不删除，项目规则设计只需重点挖掘仓库本身的约束与结构

### 5. 子级规则只能补充，不应推翻父级基线

局部规则的职责是缩小作用域、补充细节、明确放置边界，而不是否定根规则。

## 决策表

| 目标                                          | Claude Code 位置               | CatPaw IDE 位置                                                       | Codex CLI 位置 |
| --------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | -------------- |
| 所有人始终都要看到                            | 根 `CLAUDE.md`                 | `.catpaw/rules/*.md`（`ruleType: Always`）                            | 根 `CLAUDE.md`（经回退名单）或根 `AGENTS.md` |
| 机器级全局基线（跨仓库）                      | `~/.claude/CLAUDE.md`          | —                                                                     | `~/.codex/AGENTS.md`（临时覆盖用 `AGENTS.override.md`） |
| 只有某个子树需要看到                          | 该子树下的 `CLAUDE.md`         | 子树下的 `.catpaw/rules/*.md`（`ruleType: Always`）                   | 该子树下的 `CLAUDE.md`（经回退名单；需从该子树内启动才加载） |
| 横跨多个目录但可由 glob 命中                  | `.claude/rules/*.md` + `paths` | `.catpaw/rules/*.md`（`ruleType: Auto Attached` + `globs` + `paths`） | 无 glob 机制；下沉到最近目录的指令文件 |
| 当前用户个人、仅当前仓库适用                  | `CLAUDE.local.md`              | —                                                                     | 不读取（排进回退名单也会被同目录更优先的 `CLAUDE.md` 遮蔽，实际不可行） |
| 目录级规则已有 `.catpaw/rules/readme.md` 体系 | 维护 sibling `CLAUDE.md`       | 维护 `readme.md`                                                      | sibling `CLAUDE.md` 已被回退名单覆盖，无需额外文件 |
| 一次性工作流、不是持久化规则                  | skill，不放进 `CLAUDE.md`      | skill，不放进 `.catpaw/rules/`                                        | skill，不放进指令文件 |

## 目录识别启发式

分析仓库时，优先按“语义边界”而不是目录层级深度分类。

### 仓库根

通常适合保留：

- 项目概览
- workspace / monorepo 结构说明
- 根命令
- 全局代码质量约束
- 指向下层规则的导航

### `apps/`、`packages/`、`services/`、`modules/`

如果每个子目录是独立产品、包或子系统：

- 给每个稳定子系统一个局部 `CLAUDE.md`
- 内容写该区域独有的约束，不重复根规则

### `src/pages`、`features`、`domains`

如果目录承载页面、业务域或功能分片：

- 页面根目录适合写放置策略与分形组织原则
- 具体页面目录只有在差异足够大时才继续下沉

### `components`、`types`、`utils`、`hooks`

这类共享目录适合写“共享边界”：

- 什么内容才算全局共享
- 页面私有内容应该下沉到哪里
- 不要混入与目录职责无关的业务规则

### `tests`、`__tests__`、`specs`

优先用 `.claude/rules/testing.md` 这类路径规则，而不是给每个测试目录都写 `CLAUDE.md`。

### `docs`、`scripts`、`configs`

只有当这些目录有稳定编辑规范时才建规则；否则保持依赖根说明即可。

### 示例、产物、镜像目录

以下目录通常不值得建局部规则：

- `dist`
- `coverage`
- `build`
- 自动生成目录
- 第三方镜像目录
- 临时实验目录

## 标准执行流程

### Step 1：盘点现状

至少检查：

- 现有 `CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules/*.md`
- 现有 `.catpaw/rules/*.md`（检查 frontmatter 字段是否正确：`ruleType`、`globs`、`paths`）
- 是否存在 `.catpaw/rules/readme.md` 约定
- `.claude/rules/` 和 `.catpaw/rules/` 中是否存在同名规则正文不一致的问题
- CatPaw 的 `globs` 与 `paths` 是否使用了同一组 glob 条目
- 规则目录中是否已有以 `km-`、`km-web-`、`km-rn-` 为前缀的文件；若存在，标记为既有通用资产，默认排除在本次项目规则重构范围之外
- 仓库中是否已有 `AGENTS.md` / `AGENTS.override.md`；它们与同目录 `CLAUDE.md` 是否语义重复或冲突（已存在的 `AGENTS.md` 是跨工具资产，处置前必须确认）
- 用户的 `~/.codex/config.toml`（或项目 `.codex/config.toml`）是否已配置 `project_doc_fallback_filenames`；如果 Codex 是目标工具且未配置，优先落地到仓库级 `.codex/config.toml`（随仓库分发、trust 门控）；写用户级配置前必须先征得用户确认
- 目录树中哪些区域是真正长期维护的代码区域
- 当前规则是否过于集中、重复、冲突、缺少作用域

输出一个目标清单：
`{ path, kind, current_state, recommended_action, reason }`

### Step 2：识别稳定边界

基于目录名、代表性文件、已有文档与代码组织判断：

- 哪些是仓库级共识
- 哪些是子系统级约束
- 哪些是横切关注点
- 哪些只是临时结构，不值得建规则

判断不清时，优先保守，不要过度拆分。

### Step 3：设计目标布局

默认优先产出如下三层：

1. 根 `CLAUDE.md`
2. 少量高价值的嵌套 `CLAUDE.md`
3. 少量带 `paths` 的 `.claude/rules/*.md` + 对应的 `.catpaw/rules/*.md`

如果仓库已有 `.catpaw/rules/readme.md` 体系，则目录级规则继续以该文件为真相源，再保持 sibling `CLAUDE.md` 与其正文一致。

所有横切规则文件应同时产出 `.claude/rules/` 和 `.catpaw/rules/` 两个版本，且同名文件正文必须完全相同；差异只允许存在于 frontmatter。

### Step 4：重写根 `CLAUDE.md`

根文件应做到：

- 能让首次进入仓库的 Claude 快速理解项目
- 不携带大段局部规范
- 明确指出哪些子系统有自己的规则
- 明确指出哪些横切规则通过 `.claude/rules` 加载

### Step 5：下沉局部 `CLAUDE.md`

只给高价值目录创建局部规则，例如：

- `apps/web/CLAUDE.md`
- `packages/logger/CLAUDE.md`
- `reactive-state/react/CLAUDE.md`
- `src/pages/CLAUDE.md`

局部文件应只回答三件事：

- 这个目录负责什么
- 什么该放这里，什么不该放这里
- 在这里改代码时优先遵循什么局部范式

### Step 6：抽横切规则到 `.claude/rules` 和 `.catpaw/rules`

以下类型优先使用路径规则：

- 测试文件
- React / Vue / TSX 组件
- API handler
- docs / markdown
- 配置文件

每个横切规则需同时产出两个文件，且同名文件正文必须完全相同；差异只允许存在于 frontmatter。

#### Claude Code 最小模板（`.claude/rules/*.md`）

```markdown
---
paths:
  - "src/**/*.tsx"
  - "packages/*/src/**/*.tsx"
---

# React 组件规则

- 导出组件时优先保持接口清晰。
- 共享组件不要耦合页面私有状态。
```

#### CatPaw IDE 最小模板（`.catpaw/rules/*.md`）

```markdown
---
ruleType: Auto Attached
globs: src/**/*.tsx,packages/*/src/**/*.tsx
paths:
  - "src/**/*.tsx"
  - "packages/*/src/**/*.tsx"
---

# React 组件规则

- 导出组件时优先保持接口清晰。
- 共享组件不要耦合页面私有状态。
```

**字段填写规则**：

- `ruleType`：横切规则一律使用 `Auto Attached`
- `globs`：直接复用同一条规则的路径 glob，用逗号分隔（如 `src/**/*.service.ts,src/**/index.tsx`）
- `paths`：与 `globs` 保持完全一致，按数组列出相同条目
- 全局规则使用 `ruleType: Always`，不需要 `globs` 和 `paths`

### Step 7：收敛重复与冲突

完成后必须处理：

- 根文件里残留的局部内容
- 子级原封不动重复父级的段落
- `.claude/rules` 没有 `paths` 导致的过宽作用域
- `.catpaw/rules` 横切规则没有 `globs` 或 `paths` 导致的过宽作用域
- `.catpaw/rules` 的 `ruleType: Auto Attached` 缺少 `globs`（必填字段）
- `.claude/rules/` 和 `.catpaw/rules/` 中同一规则的正文内容不一致
- 为了"看起来完整"而机械生成的大量空洞规则文件

### Step 8：验证加载行为

至少验证：

1. 根规则是否足够短且全局化
2. 局部规则是否只放在真正会进入的目录
3. Claude Code 的路径规则是否带 `paths`
4. CatPaw 的横切规则是否设置了 `ruleType: Auto Attached` 并填写了 `globs` 和 `paths`
5. CatPaw 的 `globs` 与 `paths` 是否使用完全一致的 glob 条目
6. `.claude/rules/` 和 `.catpaw/rules/` 同名规则正文是否一致
7. 导入是否没有破坏懒加载目标
8. 如果 Codex 是目标工具：回退名单已配置、无与 `CLAUDE.md` 并存冲突的 `AGENTS.md`、根→cwd 项目指令链合并不超 32 KiB（全局层不占此预算）；可用 `codex --ask-for-approval never "Summarize the current instructions."` 验证
9. 如果可用，`/memory` 中的已加载文件是否符合预期

## 输出与落地要求

如果用户让你“改项目”，默认直接落地文件，并在汇报时给出：

1. 新的规则布局
2. 每个新增或更新文件的职责
3. 为什么这些目录值得有局部规则
4. 哪些目录故意不建规则，以及原因
5. 仍存在的不确定点或后续可继续拆分的区域

不要只给抽象建议；能改就改。

## 文件模板

### 根 `CLAUDE.md` 模板

```markdown
# 项目指令

## 项目概览

- 仓库类型：...
- 关键子系统：...

## 全局规则

- ...

## 开发入口

- 构建：...
- 测试：...

## 局部规则导航

- `packages/logger/` 有自己的 `CLAUDE.md`
- React 组件规则在 `.claude/rules/react-components.md`
```

### 目录级 `CLAUDE.md` 模板

```markdown
# 目录说明

## 这个目录负责什么

- ...

## 放置约束

- 放什么
- 不放什么

## 开发偏好

- ...
```

### 全局 `.catpaw/rules/*.md` 模板（`ruleType: Always`）

始终加载的规则，等同于根 `CLAUDE.md` 的 CatPaw 版本：

```markdown
---
ruleType: Always
description: 项目全局基线规则
---

## 项目基本信息

- ...

## 全局规则

- ...
```

### 横切 `.catpaw/rules/*.md` 模板（`ruleType: Auto Attached`）

按需加载的横切规则，编辑匹配文件时自动附加：

```markdown
---
ruleType: Auto Attached
globs: **/__tests__/**,**/*.test.ts,**/*.spec.ts
paths:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "**/*.spec.ts"
---

# 测试规则

- 测试覆盖率不低于 80%。
- 测试文件与源文件同目录放置。
```

### 目录级 `.catpaw/rules/readme.md` 模板

仅在仓库已经采用该体系时使用：

```markdown
---
ruleType: Always
description: 目录职责简述
---

## 目录说明

- ...

## 约束

- ...
```

如果该目录的规则仅针对特定文件类型，可改用 `Auto Attached`：

```markdown
---
ruleType: Auto Attached
globs: packages/core/src/**/*.ts,packages/core/src/**/*.tsx
paths:
  - "packages/core/src/**/*.ts"
  - "packages/core/src/**/*.tsx"
---

## 核心包开发约束

- ...
```

随后让 sibling `CLAUDE.md` 保持与正文一致，只去掉 frontmatter。

## 推荐布局示例

对典型 monorepo，优先考虑这种布局：

```text
repo/
├── CLAUDE.md
├── .claude/
│   └── rules/
│       ├── testing.md          # paths: ["**/*.test.ts"]
│       ├── react-components.md # paths: ["src/**/*.tsx"]
│       └── markdown.md         # paths: ["docs/**/*.md"]
├── .catpaw/
│   └── rules/
│       ├── base.md             # ruleType: Always（全局基线）
│       ├── testing.md          # ruleType: Auto Attached, globs: **/__tests__/**,**/*.test.ts,**/*.spec.ts
│       ├── react-components.md # ruleType: Auto Attached, globs: src/**/*.tsx,packages/*/src/**/*.tsx
│       └── markdown.md         # ruleType: Auto Attached, globs: docs/**/*.md
├── apps/
│   ├── web/
│   │   └── CLAUDE.md
│   └── admin/
│       └── CLAUDE.md
├── packages/
│   ├── logger/
│   │   └── CLAUDE.md
│   └── core/
│       └── CLAUDE.md
└── shared/
    ├── components/
    │   └── CLAUDE.md
    └── types/
        └── CLAUDE.md
```

**说明**：

- `.claude/rules/` 和 `.catpaw/rules/` 中的同名规则文件（如 `testing.md`）正文必须完全一致，仅 frontmatter 格式不同
- `.catpaw/rules/base.md` 是全局基线规则，对应根 `CLAUDE.md` 的内容，使用 `ruleType: Always`
- 横切规则在 `.catpaw/rules/` 中使用 `ruleType: Auto Attached` + `globs` + `paths`，且 `globs` 与 `paths` 使用同一组 glob；在 `.claude/rules/` 中仅使用 `paths`
- Codex 用户几乎无需新文件：在仓库级 `.codex/config.toml`（trust 后生效，随仓库分发）或用户级 `~/.codex/config.toml`（需用户确认）配置 `project_doc_fallback_filenames = ["CLAUDE.md"]` 后，根与各子目录的 `CLAUDE.md` 即构成 Codex 的指令链；`.claude/rules/` 与 `.catpaw/rules/` 对 Codex 不可见，其中的关键规则需在对应目录 `CLAUDE.md` 有落点。启用了 Codex GitHub code review 的仓库，另在根 `AGENTS.md` 承载 `## Code Review Rules`

## 常见错误

- 把整个仓库的细节都塞进根 `CLAUDE.md`
- 给每个叶子目录都生成一个规则文件
- 用 `@...` 导入大段内容，误以为实现了懒加载
- Claude Code 规则文件没有 `paths`，导致启动时广泛加载
- CatPaw 横切规则设置了 `ruleType: Auto Attached` 但没有填写 `globs`（必填字段）
- CatPaw 的 `globs` 与 `paths` 写成了两套不同的匹配范围，导致规则作用域漂移
- `.claude/rules/` 和 `.catpaw/rules/` 中同名规则的正文内容不一致，导致不同工具行为不同
- 把以 `km-`、`km-web-`、`km-rn-` 为前缀的既有规则文件当成项目自身规则去改写、迁移或清理
- 局部规则只是把父级规则再抄一遍
- 仓库已经有 `.catpaw/rules/readme.md` 体系，却又并行手写另一套目录真相源
- 为了"支持 Codex"在每个目录复制一份内容雷同的 `AGENTS.md`，与 `CLAUDE.md` 形成双真相源（应改用 `project_doc_fallback_filenames = ["CLAUDE.md"]`）
- 同目录同时放 `AGENTS.md` 和 `CLAUDE.md` 却内容不同——Codex 只读 `AGENTS.md`，Claude 只读 `CLAUDE.md`，两边行为悄悄分叉
- 把 Markdown 指令写进 `~/.codex/rules/*.rules`（那是 Starlark 命令策略文件，不是指令加载机制）
- 期望 Codex 像 Claude Code 一样在会话中进入子目录时懒加载——Codex 只在启动时构建 root→cwd 链
- 指令链合并总量超过 32 KiB 未察觉，尾部（最深层的）规则被静默截断

## 默认行为

除非用户明确只想了解概念，否则默认按“分析仓库 -> 设计分层 -> 直接落地文件 -> 汇报原因”的方式执行。

## 示例触发语句

- “请把这个项目重构成适合 Claude Code 的渐进式规则架构。”
- “根据目录功能，帮我创建不同的 `CLAUDE.md` 和规则文件。”
- “根规则太重了，帮我拆成根规则、目录规则和路径规则。”
- “按照 Claude 持久化指令的加载机制改造当前仓库。”
- “检查这个 monorepo 应该在哪些目录放局部 `CLAUDE.md`。”
- “让 Codex 也用上这套分层规则，但不想维护两份 AGENTS.md。”
- “帮我配置 project_doc_fallback_filenames 让 Codex 读 CLAUDE.md。”
