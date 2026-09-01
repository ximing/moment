# 时刻 Moment — Web 便利贴相册网格 Design

> 日期：2026-09-01
> 状态：已与用户对齐（形态 + 卡片信息层）
> 范围：`apps/web` 时间线主列（大家的日子、链页、分享相册）
> 视觉参考：[`../mocks/memory-space/album.html`](../mocks/memory-space/album.html)
> 权威边界：数据模型、权限、媒体、分享、feed/链列表/时间索引 HTTP 契约以 `2026-08-15-moment-design.md` 与既有 dto 为准。人物/地点字段与公开页红线以 `2026-08-28-moment-people-place-design.md` 为准。本 spec **不改** dto、server API、compose 发布面板、右栏时间索引的跳转语义。
> 修订关系：本 spec **替换** `2026-08-17-web-c-end-redesign.md` §5（日子线作为主列结构）与 §6（时刻不是完整卡片、内容层无阴影）在「时间线主列」上的规则。壳层、页眉、时间索引、Button/Modal/Field/Menu/Feedback 组件规范仍听 C 端总规范。Token 仍不得新增。

## 0. 产品决策（已与用户对齐）

- 现在的主列是日子线 + list item（头像 32 + 内容列）。视觉密度偏低，形态接近动态流。
- 主列改为 **相册网格**：一条时刻是一张 **便利贴纸面**（纸边、轻阴影、可大可小），不是 list item，也不是 3D 房间、记忆墙画布或横向/纵向时空轴。
- 右侧时间索引保留：年份章节、月份入口、点月份锚定 `before` 重查，语义与 `2026-08-17` §7 / `timeline-rail.tsx` 一致。
- 卡片必须消化现有字段：正文、Tag、人物、地点、作者、发生时间、链来源、回应数、语音/影像时长。表情条不进网格。
- 后端与 dto 不变。筛选仍走已有 query：`tag_id` / `person_id` / `place` / `before` / `order`。
- App 列表形态不在本 spec；本轮只改 Web。

否决（探索过、不再做）：走进日子的 3D 房间、无限照片墙画布、时间焦距轴、家里的相框墙作为首页。

## 1. 非目标

- 不改 `GET /feed`、`GET /chains/:id/moments`、`GET /moments/:id`、月份索引、tag/person/place 接口的字段名与分页。
- 不改记下/编辑面板、灯箱内部控件、评论详情页 `/moments/:id` 的信息结构。
- 不新增 token、不改 `tokens.css` 色值、不改 package scripts。
- 不做瀑布流第三方库；自研最短槽位打包（可 span 2），按月分包以免跨月抽洞。
- 不在网格上做表情点选、不在网格上展开评论输入。

## 2. 页面结构

宽屏（≥1400px）工作区改为：

```text
[ 左栏 208 ]   [ 相册网格 自适应 ]  32  [ 时间索引 184 ]
```

- 相册主列 **不再受 `--content` 760px 阅读列限制**。列数按主列宽度计算：卡最小内容宽 200px（含纸边），列数 clamp 在 2–4。间隙 12px（网格档位）。
- 中屏（900–1399px）：左栏收顶栏（总规范 §3.2）；网格 2–3 列；时间索引仍进页眉月份入口 + Sheet。
- 小屏（<900px）：网格 2 列；卡片点击区仍 ≥44px。
- 链首页封面通栏规则、右栏 `pinBelowCover` 不改。
- 页眉（大家的日子 / 链眉 / 记下此刻）不改。日子线、日期结、Composer 挂在线头上：删除。记下只保留页眉按钮 + 下滚 FAB。

按月分段：

```text
2026 · 9 月
[ 最短槽位瀑布：本月卡片 ]
2026 · 8 月
[ 最短槽位瀑布：本月卡片 ]
```

- 月头是 caption / muted，字距放松，不是大日期结。
- `groupMomentsByDate` 仍可按墙钟日分组数据，但 **主列 UI 按月渲染**（同一月内不再插「今天/昨天」章节，避免把网格拆稀）。发生日信息写在卡片纸边上。
- `order=created_at` 时仍按添加时间序铺网格，月头按 `created_at` 墙钟月；右栏 `before` 在该序下不可用（现有 dto 约束），行为与现在一致。

无限滚动、`limit: 50`、底部哨兵、失败横幅：沿用现 Timeline。

## 3. 便利贴卡片

组件仍落在 `apps/web/src/timeline/`：现 `MomentSheet` 改为便利贴外壳，不新开设计系统包。每卡仍一颗 `MomentSheetService`。

### 3.1 纸面

- 底：`--field-bg`（纸色，比 `--surface` 更暖、不发白）。页面底用 `color-mix(stroke 20%, bg)` 托起纸面，侧栏/右栏不画分割线。
- 内边距：8px 画面四周，纸边书写区再 8px 4px 2px（档位内）。
- 圆角：直角。播放入口用作者头像圆。
- 轻阴影：`0 8px 22px color-mix(in srgb, var(--ink) 12%, transparent)`。列表不倾斜、不悬停抬起。详情无纸面阴影。禁止 `--elev` / `--shadow` / `--floating-shadow`。
- `focus-visible`：`--focus` 环，offset 2px。

### 3.2 面子（媒体）

| `type` | 面子 |
|---|---|
| `media` | 第一张图铺满面子；多于 1 张时画面右下角 caption 色叠 `N` |
| `video` | 封面（`posterDerivedUrl` \|\| `posterUrl` \|\| 第一帧图）+ 画面左下作者头像 |
| `voice` | 无大图：作者头像作播放钮 + 竖线波形条；不在网格里放进度条播放器。附图只在详情页展开 |
| `text` | 无面子图，书写区从纸顶开始，正文最多 5 行 |

- 有媒体时媒体自己当面子，不再外套第二层卡片。
- 点击面子图/影像：现有 `Lightbox`（`MomentSheetService.lightboxIndex`）。
- 点击语音「过」：就地播放，不进详情。

### 3.3 地点叠在画面上

有 `place.name` 且面子是图或影像时：画面下沿左侧叠 `📍 {name}`，caption 色，单行省略。阴影字用 `color-mix(in srgb, var(--ink) 70%, transparent)` 的 text-shadow，禁止写死黑。

公开分享路径无 `place`：不渲染。链内路径有地点无图（纯文字/纯语音）：地点改走纸边 meta，不悬空。

### 3.4 纸边书写区（信息层）

两行，缺项省略，不留空标签。

**第一行（body，最多 2 行 clamp；纯文字卡 5 行）：**

```text
#Tag #Tag 正文
```

- Tag 规则继承总规范 §6.2：与正文同一文本流、同一字号。纸边用已有 `text-meta`（13 / 20），颜色 `--tag`，`#` 前缀，不画胶囊。禁止新字号。
- 无正文、有 Tag：只渲染 Tag。
- `kind !== 'standard'` 的 payload 摘要：若与 `content` 不同，接在正文后，muted。

**第二行（meta，可折行）：**

```text
朵朵 · 妈妈    作者 · 9/1 早    3 回应    ● 链名
```

顺序固定：

1. 人物名，最多 3 个，以 ` · ` 连接；超过 3 个末尾 `…`。`source=ai` 的人物名后不跟「AI」二字（密度）；点开详情仍可区分。
2. 纯文字/纯语音的地点（有图时已在面子上，这里不再重复）。
3. 作者昵称 · 发生时钟（`formatHappenedClock`）· 补记标记。
4. baby 链年龄标注（现 `ageLabel`），有则跟在时间后。
5. `commentCount > 0` 才显示 `N 回应`；0 不显示（网格里不需要占位入口）。
6. 仅「大家的日子」显示链来源：现 `ChainMark` + 链名，可点进链页。单链页、分享页隐藏。

禁止在纸边再放头像列——作者只出现在 meta 字里，这是与 list item 的分界。

### 3.5 异形占位（span）

当月相册用「最短槽位」瀑布，不是 CSS Grid 行模型：

- 列数 2 / 3 / 4 随断点。卡按时间序投入 **当前最矮、且能放下其 span 的相邻槽**（并列取最左）。
- 竖图 / 竖屏视频永不跨列，面子跟自身宽高比走（只把极端超竖夹到 9:16），避免裁进横盒子。
- 横图 / 横屏视频 / 横封面多图最多 span 2，不再跨 3 列占满主列。
- 独占一个月：横图/视频 span 2，竖图仍 span 1。
- 列数不足、或相邻槽不等高会留洞时把 span 逐级减到能放平。
- 面子高度用媒体 `width/height`（图片解码后的 natural 比优先）和所占列宽算；纸边高度用 `@chenglou/pretext` 按 `text-meta`（13 / 20）量正文。dto 写成横、画面实际是竖时，按实测比改回 span 1，避免跨列后再按竖比把高度撑爆。
- 实测高度再修正一次，避免估计和真实纸边不一致。

| 条件 | 列跨 | 面子宽高比 |
|---|---|---|
| 横屏 `video`，或单图 `width/height ≥ 1.4` | 最多 2 | 自身比，更宽夹到 16/9 |
| `media` 且 2–9 张、封面为横图 | 最多 2 | 封面自身比 |
| 竖拍 / 竖屏视频（含 3:4、9:16） | 1 | 自身比，更竖夹到 9:16 |
| 手机横拍 4:3 与介于 3/4–4/3 的单图 | 1（独占月可 2） | 用照片自身比 |
| `voice` / `text` | 1（独占月可 2） | 无面子，内容撑开 |

面子按 `aspect-ratio` 吃所占列宽，不再用 168/192/240 固定高度——家庭照片以手机 4:3 / 3:4 为主，固定高度会把脑袋裁掉。`object-fit: cover` 只处理被夹过的极端比。

### 3.6 互动

| 手势 | 行为 |
|---|---|
| 点面子图/影像 | Lightbox |
| 点语音播放 | 就地播 |
| 点纸边正文/空白 | `/moments/:id`（评论主场，现路由） |
| 点 `#Tag` | 现 tag 筛选（`RailFilter.tagId`）；单链范围内 |
| 点人物名 | 现 `onPersonFilter` |
| 点地点 | 现 `onPlaceFilter` |
| 点链名 | `/chains/:id` |
| 自己的卡 `···` | 仍在纸面右上绝对定位，不进 meta 行；编辑/删除现逻辑 |

表情：网格不渲染 `ReactionBar`。详情页与现网一致。

筛选 chip（人物/地点/回到今天）：仍用 `FilterChips`，贴在网格上方。

## 4. 分享页

`/share/:token` 同一套网格。不渲染人物、地点（dto 无字段）。无表情、无评论输入；`commentCount` 若序列化有值可只读显示，无则省略。媒体 URL 仍带 `?st=`。

## 5. 空态 / 加载 / 错误

文案与按钮沿用 `2026-08-16-web-product.md` §4 空态表。骨架改为 8 张纸面（2 行 × 4 列），不是三张「纸」列表。整页失败横幅 + 重试，左栏仍在。

## 6. 工程落点

| 文件 | 变化 |
|---|---|
| `apps/web/src/timeline/timeline.tsx` | 去掉日子线/日期结；按月最短槽位瀑布；哨兵保留 |
| `apps/web/src/timeline/album-pack.ts` | span 1/2 最短槽位；列数断点 |
| `apps/web/src/timeline/moment-sheet.tsx` | 便利贴外壳 + 3.2–3.4 信息层；Lightbox / 删除 / 评论展开迁到详情为主，预览评论从网格移除 |
| `apps/web/src/timeline/moment-sheet.service.ts` | 可删 `showComments` 预览路径（网格不再展开评论）；Lightbox / 删除保留 |
| `apps/web/src/shell/Shell.tsx` | 主列不再锁 760；为网格让出宽度 |
| `apps/web/src/pages/feed-home/index.tsx` `chain-home/index.tsx` `share-album/index.tsx` | 传入网格所需 chainLook / ageLabel / 筛选回调，与现在相同 |
| `apps/web/src/timeline/timeline-rail.tsx` `filter-chips.tsx` | 不改语义 |
| `apps/web/src/timeline/*.test.tsx` `pages/chain-home/chain-home.test.tsx` `pages/timeline-variants.test.tsx` | 断言从日子线改为网格/纸边字段 |

`groupMomentsByDate` 可保留给详情或其它调用；主列新增按月分组纯函数（与墙钟 `wall_date` / `happenedAt+offset` 现有 `dayHeading` 同源），单测覆盖月界、时区、`created_at` 序。

## 7. 测试

- 纸边：有 Tag+正文同一流；人物超过 3 个省略；有图地点在面子不在 meta；无图地点在 meta；分享卡无人地点。
- 占位：横图/视频 span 2；竖图 span 1；voice/text span 1。
- 点 Tag/人物/地点仍触发现筛选（复用 chain-home 现测试意图）。
- 右栏点月份仍写 `before`（现 rail 测试保留）。
- 日子线、日期结、「今天」大结：主列不再出现（反向断言）。
- 倾角在 `prefers-reduced-motion` 下为 0。

不测：后端分页、权限、上传。

## 8. 对既有规范的显式修订

C 端总规范下列条款在 **时间线主列** 以本文为准，其它页面仍听原文：

- §3.1 主列宽 760 + 日子线工作区 → 本文 §2 自适应网格。
- §5 日子线为全站视觉签名 → 主列不再画线；品牌签名改为便利贴纸面 + 右栏时间索引。
- §6 时刻不是完整白卡、内容层无阴影、`[头像 32]+内容列` → 改为本文 §3 纸面。Tag 同文流、链来源仅汇总页、情绪不与回应等权：精神保留，网格上情绪入口取消。
- §2.4 内容层无阴影 → 仅便利贴允许本文 §3.1 那一条轻阴影。
- §9 禁止一次性阴影 → 便利贴阴影只写在 `moment-sheet` 同目录样式（值等于 §3.1 公式）。不新增 token，其它文件不得复制该阴影。

## 9. 验收

对照 `docs/superpowers/mocks/memory-space/album.html`：纸感、异形、密度、右栏跳月、纸边能读到 Tag / 人物 / 地点 / 作者时间 / 回应。不要求样稿倾角与生产哈希一致。390 / 1024 / 1440 / 1895 与浅色/深色各看一屏网格，确认 2–4 列切换不断字、地点叠字可读。
