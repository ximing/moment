# 时刻 Moment — Web 重设计 Spec(贴纸手账风 · 双主题 · 时光链)

> 日期:2026-08-16
> 状态:已与用户对齐方向(mockup v3 + 阴影方案 A),并通过一轮对抗性审查(2 blocker / 4 major / 6 minor 已全部合入本文修正)
> 范围:重做 `apps/web` 全部视觉与交互体系;服务端新增「月份索引 + 日期锚定」两个小能力
> 权威边界:数据模型、权限、媒体、分享语义仍以 `2026-08-15-moment-design.md` 为准;Web 产品功能面以 `2026-08-16-web-product.md` 为准,本文**替换**其 §7 视觉体系并对 §3–§6 的交互做如下修订。冲突时:契约听原文,功能听 web-product,视觉与交互听本文。

## 0. 背景与目标

现有 web 端为「米色纸感 + 衬线」皮肤,用户判定其不现代、不商业,要求系统性重做而非补丁。方向经三轮 mockup 迭代确定为「晴天 · 贴纸手账」:奶油底、墨描边、贴纸元素、珊瑚橙动作色,深浅双主题。

**成功标准不变**(web-product §1 五条全部沿用),新增三条:

6. 浅色/深色主题可切换(跟随系统/浅/深三态),切换无闪烁(FOUC),两主题逐页可读。
7. ≥1400px 宽屏出现右栏「时间索引」,可点击年月跳转到对应月份,跳转后有「回到最新」出口。
8. 视觉签名「时光链」在时间线可见:虚线链 + 日期贴纸节点 + 卡片挂链节。

**非目标**沿用 web-product §1,并追加:不做双向无限滚动、不做 owner 删除他人时刻的 UI 入口(后端权限允许,UI 本轮仍只给本人时刻 kebab,列入 backlog)、不做移动端底栏。

## 1. 视觉体系

### 1.1 色彩 token(双主题,落在 `apps/web/src/styles/tokens.css`)

| Token | 浅色 | 深色 | 唯一语义 |
|---|---|---|---|
| `--bg` | `#fdf0d9` | `#171208` | 页面底 |
| `--surface` | `#fffdf8` | `#221b10` | 卡片/面板 |
| `--ink` | `#241a0b` | `#f2e8d5` | 主文字;浅色下兼结构描边 |
| `--muted` | `#a68d5f` | `#99855f` | 次要文字 |
| `--line` | `#241a0b` | `#4d4231` | 结构线(深色主动后退、低对比) |
| `--shadow` | `rgba(36,26,11,.10)` | `rgba(0,0,0,.45)` | 偏移影颜色(几何见 §1.2) |
| `--action` | `#f4552f` | `#f4552f` | **动作**:发布按钮、FAB、通知角标、主 CTA |
| `--action-fg` | `#ffffff` | `#ffffff` | 动作按钮上的字 |
| `--select` | `#ffc94d` | `#ffc94d` | **选中/热态**:当前导航、我点过的表情、日期贴纸(深色) |
| `--danger` | `#c93a2e` | `#ff8a66` | 危险操作 |
| 贴纸四色 | 粉 `#ffd9e6` / 蓝 `#cfe8ff` / 薄荷 `#bfe8d0` / 紫 `#e6dbff` | 粉 `#3a2831` / 蓝 `#233244` / 薄荷 `#22392f` / 紫 `#2e2842` | **仅装饰**,由 hash 轮换(见 §1.4),永不表意 |
| 贴纸描边(深色) | 同 `--line` | 粉 `#8a5a70` / 蓝 `#56759c` / 薄荷 `#4d7a67` / 紫 `#6a5f94` | 深色下同色系中亮边 |

**色彩职责纪律(对抗审查 #5/#8 的修正):**

- 橙=动作、黄=选中/热态、墨=文字与浅色描边,**两主题语义完全对称**;深色下动作仍用珊瑚橙 `#f4552f`(在 `#171208` 底上对比足够),禁止深色把动作也压进黄色导致「当前导航」与「主按钮」同色。
- 每个颜色只有一行语义;新增用途先加 token,禁止组件内写死色值,禁止组件层按主题各自判断颜色。

### 1.2 形状语言

- 卡片/面板:圆角 16–18px,`2px solid var(--line)`,浅色阴影 `4px 4px 0 var(--shadow)`(对抗审查后定为 10% 墨淡影,即 mockup「方案 A」);深色同几何、深影。
- 贴纸(标签/表情/日期/状态):圆角 99px 胶囊,1.5–2px 描边,小一号偏移影 `2px 2px 0 var(--shadow)`。
- 按钮:主按钮橙底圆角 99px 描边 2px;次按钮 surface 底描边;危险按钮 `--danger`。
- 媒体宫格:2px 描边 + 圆角 10–12px,格间距 4–6px。

### 1.3 字体

- 标题/字标:**得意黑 Smiley Sans**(SIL OFL,可商用,本地打包进 `apps/web/public/fonts/`)。CJK 全量 woff2 为 MB 级,**必须子集化**:只用于固定文案(字标「时刻」、空态标题、面板/页面固定标题字),按这些字形子集化 + `font-display: swap` + 系统字回退。动态内容(链名、昵称、正文)一律系统黑体,不走得意黑。
- 正文:系统黑体 16–17px,行高 1.6。
- 旧 tokens 的衬线标题栈(`Source Han Serif` 等)整体移除。

### 1.4 链颜色点

`chains` 表无 color 字段,**禁止**为此改 schema。客户端确定性推导:`hash(chainId) % 4` → 贴纸四色盘,同一链在所有页面(侧栏点、选链卡、链眉)颜色恒定。hash 用简单稳定算法(如 FNV-1a),写在 `src/lib/chain-color.ts`。

### 1.5 主题机制

- 三态:跟随系统 / 浅 / 深,存 `localStorage["moment:theme"]`,「我的」页提供开关。
- 实现:`<html data-theme="light|dark">` 切换 token;跟随系统时监听 `prefers-color-scheme`。
- **防 FOUC**:`apps/web/index.html` 内联阻塞 snippet,首绘前读 localStorage + 媒体查询打下 `data-theme`。
- **分享页恒浅**:`/share/:token` 无视 localStorage 与系统偏好,强制 `data-theme="light"`(长辈可读性优先,页面无壳无开关)。

### 1.6 动效

150–250ms ease;`prefers-reduced-motion` 全局降为 1ms(tokens 已有 `--ease`,沿用)。签名微动效:发布成功后新卡片从链节「长出来」(opacity+translateY 短动画)。禁止弹跳与装饰性大动效。

## 2. 布局与导航

- 左栏 232px:得意黑字标(「刻」用 `--action`)、当前项 `--select` 黄底贴纸态、链列表带 §1.4 颜色点、通知角标橙底白字。
- 主列单列,`--content` 680px(由 720 微调,配合链条缩进)。
- **≥1400px 右栏**(宽屏才出现):上「时间索引」(§4),下「筛选」(链多选 chips → `chain_ids`;标签单选 → `tag_id`;「按添加时间看补发」开关 → `order=created_at`)。
- 900–1400px:右栏收进主列顶部一枚「筛选/索引」贴纸按钮,点开为抽屉。
- 路由结构沿用 web-product §3,不增删。

## 3. 时间线与「时光链」签名

### 3.1 链条渲染规则

- 主列左侧 26px 缩进区:`2.5px dashed var(--muted)`(透明度 ~0.4)垂直虚线贯穿。
- 日期分组头 = 链上贴纸节点:浅色紫底墨字、深色黄字琥珀边(`--select` 系);节点左侧一枚圆点(`--select` 黄)。
- 卡片左上角外侧挂「链节」圆环(surface 底 + `--line` 描边)。

### 3.2 分组与分页的正确性(对抗审查 #6 修正)

- 日期分组必须基于 `pages.flatMap` 后的**全量已加载列表**计算,跨页边界同一天只渲染一枚日期贴纸;分组 key 用日期字符串,保证新页插入时稳定。
- 分组日期用**作者本地墙钟**(与卡片 `formatHappenedAt` 一致:`happened_at − happened_tz_offset`)。
- `order=created_at`(按添加时间看补发)下 happened_at 非单调:**链条与日期贴纸整体隐藏**,退化为纯卡片列表。这是签名元素的约定降级形态,不是 bug。

### 3.3 其余沿用

媒体规则(1 铺满 / 2–3 并排 / 4–9 宫格)、无限滚动 `limit:50` 游标、空态三态、骨架(骨架卡也挂链条)、失败横幅,均沿用 web-product §4,仅换肤。

## 4. 时间索引与新 API(服务端变更)

### 4.1 月份索引

`GET /api/feed/month-index`(挂 feed 模块,复用其「我参与的链」过滤逻辑):

- 入参:`chain_ids`(可选,逗号分隔 uuid,语义同 feed——仅用于在我的链范围内收窄,非成员链静默忽略)、`tag_id`(可选)、`tz_offset`(**必填**,整数分钟,语义同 `getTimezoneOffset`:东八区 = -480)。
- 归桶时区 = **查看者时区**(对抗审查 blocker #1 的定稿):SQL 按 `happened_at − INTERVAL tz_offset MINUTE` 取 `DATE_FORMAT '%Y-%m'` 聚合 count;排除软删。
- 返回 `{ months: [{ month: "2026-08", count: 12 }, ...] }`,按月倒序;空范围返回空数组。
- dto:`monthIndexQuerySchema`(tz_offset 用 `z.coerce.number().int().min(-840).max(840)`,缺省拒绝 → VALIDATION_ERROR);`feedQuerySchema` 的既有字段不动(`before` 的新增见 §4.2)。

**刻意保留的不一致**:索引归桶用查看者时区,卡片与日期贴纸展示用作者本地(§3.2)。跨时区家庭在月首/月末可能看到「索引计数」与「分组贴纸」差一两条——索引是导航辅助不是账本,接受并在代码注释中说明。

### 4.2 日期锚定 `before`

- `feedQuerySchema` 与 `listMomentsQuerySchema` 各加可选 `before`:ISO 8601 datetime 字符串。
- 语义:`happened_at < before`(严格小于),仅 `order=happened_at` 可用;feed 用 zod `superRefine` 拒绝 `before + order=created_at`(VALIDATION_ERROR)。链内 moments 列表无 `order` 字段,天然只有 happened_at 语义,直接加 `before` 即可,**不要**顺手给它加 order。
- 与游标共存:翻页时 `before` 与 `cursor` **同时传**,服务端 AND 取更严上界;游标格式与解码逻辑(cursor.ts)不改。
- 客户端生成规则:`before` = 目标月份在**查看者时区**的月初 00:00 换算的 UTC ISO 串(与 §4.1 归桶时区一致)。
- 链页复用 `GET /chains/:id/moments` 的 `before`;`month-index` 传单个 `chain_ids` 即得该链索引。

### 4.3 跳转交互(对抗审查 blocker #2 的定稿)

- 点击索引月份 = **替换查询参数重查**:跳到月份 M 时,`before` = M 的下一月月初 00:00(查看者时区)换算的 UTC ISO 串,时间线以此重置加载(不是分页态延续),React Query 换 key 重取第一页,第一屏即 M 月下旬的内容,继续下滚自然进入 M−1 月。
- 锚定态时间线顶部固定一枚「← 回到最新」贴纸按钮,点击清 `before` 回第一页;锚定态下索引栏高亮当前月。
- 明确不做双向无限滚动。
- 分享相册不用索引(无壳、只读、保持安静)。

## 5. 发布交互修订

- **常驻 composer**:时间线顶部一枚占位卡(挂链首,「这一刻,记点什么…」+ 媒体/标签/时间图标)。它只是**入口**:点击以显式动作打开现有 `ComposePanel` modal(带当前 `chainId` 上下文)。**不做就地展开的内联编辑器**(对抗审查 #4:避免与 ComposeContext 双状态模型、避免 effect 同步展开态,遵守 apps/web CLAUDE.md「显式动作」规则)。
- 向下滚动后 composer 滚走,右下橙色 FAB 接力,点击同样开 modal。编辑中部时刻、`?compose=1` 深链、旧 compose 路由 302,全部仍开同一个 modal——**全站只有一个发布编辑器**。
- 抑制规则:viewer 不渲染 composer 与 FAB(沿用 Shell `showCompose` 逻辑迁移);分享相册/只读上下文一律不渲染。
- 未选链(`/`)时面板第一步为大块链卡选链(带 §1.4 颜色点),沿用 web-product §5 禁令。
- 图/视频互斥、压缩参数、补记、标签、校验、失败留稿、编辑态不重传媒体,全部沿用 web-product §5,仅换肤。

## 6. 卡片互动修订

- 表情条:未点过的表情不再一排平铺,收成一枚「＋」贴纸,点开浮层再选 `REACTION_EMOJIS`;已有计数的表情照常显示;我点过的 `--select` 黄底热态。点选/取消的 API 行为不变。
- 自己的时刻:操作收进「···」kebab(编辑/删除),不再裸露两个小字按钮。owner 删他人时刻**不开放入口**(见 §0 非目标)。
- 评论预览/详情、灯箱规则沿用 web-product §4;灯箱换深墨底 + 贴纸式关闭/左右钮。
- 分享相册:无表情按钮、无评论输入,只读计数样式贴纸化;媒体 `?st=` 语义不动。

## 7. 其他页面

- **链设置**(`/chains/:id/settings`):左目录改贴纸 tab;分享链接每行一张贴纸卡,状态色:有效=薄荷、已过期=黄、已吊销=灰;吊销二次确认文案沿用。「成员/资料/危险区」交互沿用 web-product §6,权限隐藏规则逐项保留(viewer 只见成员只读;editor 无分享生成)。
- **分享相册**:同皮肤更安静——无 FAB、无 composer、无表情钮;恒浅色(§1.5);页脚「由家庭用『时刻』记录」保留。
- **登录/注册/邀请**:居中贴纸卡 + 得意黑大字标;错误人话映射沿用 web-product §9。
- **通知**:列表行贴纸化,未读橙点。
- **我的**:只读资料 + 主题三态开关(§1.5)。

## 8. 工程约束

- dto/server/api-client 变更仅 §4 三处,按 packages/dto CLAUDE.md 走全套(schema + 推导类型 + 测试 + api-client 同步 + server 使用方);server 侧按 apps/server CLAUDE.md:挂 `src/feed/` 模块、权限走 `ChainPolicy`、错误用 UPPER_SNAKE 机器码。
- tokens.css 重写为双主题;Tailwind 配置映射同步;组件逐个换肤,目录结构沿用 apps/web CLAUDE.md 放置约束。
- 得意黑字体文件进 `apps/web/public/fonts/`,构建产物自包含,不依赖 CDN。
- 不新增全局 store;Query key 继续集中在 `src/api/keys.ts`(month-index 加 key,含 tz_offset 参与 key)。

## 9. 测试与验收

**server/dto 测试(对抗审查 #12 清单):**

- month-index:跨 tz_offset 归桶(同 UTC 时刻、不同 tz_offset 请求落不同月)、chain_ids 收窄静默过滤非成员链、tag_id 过滤、软删排除、空范围返回 `[]`、倒序、缺省/非法 tz_offset → 400。
- before:单独锚定、与 cursor 同传(AND 语义)、feed 上 `before + order=created_at` 拒绝、严格小于边界(等于 before 的那条不出现)、非法值 400;链内 moments 的 before 同样覆盖。
- 既有 feed/moments 测试保持绿。

**手测清单**:web-product §10 的 10 条全保留,新增:

11. 深浅主题逐页切换检查;系统主题切换时跟随;开页面无 FOUC;分享页在任何主题设置下恒浅。
12. ≥1400px 右栏出现;点历史月跳转成功;「回到最新」返回;900px 抽屉与 FAB 互不遮挡。
13. `order=created_at` 模式下链条/日期贴纸按 §3.2 降级隐藏,切回 happened_at 恢复。
14. viewer 账号全程不见 composer/FAB/分享生成;owner 看不到他人时刻的 kebab。
15. 跨页边界的同一天只出现一枚日期贴纸(制造 50+ 条同日数据或调小 limit 验证)。

## 10. 实施顺序(供 plan 细化)

1. dto + server:month-index + before(含测试),api-client 同步
2. tokens 双主题 + index.html 防 FOUC + Tailwind 映射 + 字体子集
3. Shell 换肤(侧栏/字标/通知角标)+ 主题开关
4. Timeline:链条签名 + 日期分组 + MomentSheet 贴纸化 + 表情条 kebab 化
5. composer 入口 + FAB + ComposePanel 换肤
6. 右栏时间索引 + 筛选(含抽屉态、跳转/回到最新)
7. 链设置 / 分享相册 / 登录注册邀请 / 通知 / 我的 换肤
8. 手测清单收口

## 11. 与原有两份 spec 的关系

- `2026-08-15-moment-design.md`:后端与权限唯一权威,不变;§4 的新增端点是其 feed 能力的小扩展。
- `2026-08-16-web-product.md`:功能面继续有效;§7 视觉(token 表、衬线字体、纸感气质)由本文 §1 整体替换;§3–§6 中凡与本文 §2/§3/§5/§6 冲突的交互描述,以本文为准。
