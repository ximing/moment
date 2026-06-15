# 时刻 Moment — 链页眉成员与可见性

> 日期：2026-08-18
> 状态：已与用户对齐，待写实施计划（评审 6 条已收）
> 范围：`ChainDto` 增加成员预览；Web 链页标题右侧展示成员头像与可见性标识
> 权威边界：权限与 `visibility` 语义听 `2026-08-15-moment-design.md`；链页信息架构听 `2026-08-16-web-product.md` / `2026-08-17-web-c-end-redesign.md`。本文只增字段、不改旧字段名或旧语义。

## 1. 目标与非目标

选中一条链后，用户在标题旁一眼能看出：**谁在这条链里、各自什么角色、链是不是对链外开放。**

**成功标准：**

1. `/chains/:id` 标题右侧出现成员头像（含自己，不必先点设置）；超过 5 人时只画预览里的人加 `+N`。
2. 头像 hover（触控为点按）浮出昵称 + 角色（创建者 / 可记录 / 只看）。
3. `visibility === 'public'` 出「公开」；`link` 出「链接可看」；`private` 不画标识。
4. 人比预览多时簇尾出 `+N`，`N = memberCount - membersPreview.length`。服务端恒满足 `membersPreview.length === min(5, memberCount)`。
5. 链页不额外请求 `GET /members`；预览来自 `GET /chains/:id`。

**非目标：**

- 不改 `visibility` 三个枚举值的含义，不在设置里新做公开开关。
- 生成或吊销分享链接 **不得** 改 `visibility`（分享链接与 `visibility` 是两套机制）。
- 不在成员预览里带邮箱或未接受的邀请。
- 头像不作为设置入口（`···` 仍进设置）。
- 侧栏链列表、公开分享页 `/share/:token`、App 界面本轮不展示预览。
- App 本轮不必补与 Web 相同的新 `chain:changed` 发射（App 不画此 UI）。
- 不新增路由。

## 2. 契约

`packages/dto/src/chains.ts` 只增类型与字段：

```ts
export interface ChainMemberPreview {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: ChainRole;
}

export interface ChainDto {
  // 既有字段不变，含 visibility / myRole / ownerId
  membersPreview: ChainMemberPreview[];
  memberCount: number;
}
```

**语义（不得另解）：**

| 字段 | 规则 |
|---|---|
| `membersPreview` | 该链全部成员按序切前 5 名。`length === min(5, memberCount)`。排序：`joinedAt` 升序，并列再按 `userId` 升序。含当前用户。不含待接受邀请。 |
| `memberCount` | 该链成员总数（含自己）。恒 `>= membersPreview.length`。 |
| 单条预览 | 仅 `userId` / `nickname` / `avatarUrl` / `role`。JSON 不得出现 `email`、`joinedAt`。 |
| 头像 URL | 与 `GET /members` 相同，走现有 `avatarUrlsByUserIds` 预签名；失败则该条 `avatarUrl: null`，不导致整链失败。 |
| 超过 5 人时谁被挤掉 | 排序后的第 6 名及以后。即被排除的是 `joinedAt` 最晚者；同一秒则 `userId` 最大者先被挤掉。 |

**出现面：** 所有返回 `ChainDto` 的接口都必须带这两项：

- `POST /api/chains`
- `GET /api/chains`
- `GET /api/chains/:chainId`
- `PATCH /api/chains/:chainId`
- `POST /api/chains/:chainId/transfer`

`GET /api/chains/:chainId/members` 仍是完整成员列表（含 `joinedAt`），设置页继续用它。

`PublicShareChainInfo` / `GET /api/public/share/:token` 不增加成员预览。

**组装：**

1. 收集本次要序列化的 `chainIds`。若 `chainIds.length === 0`（例如 `listMine` 无链），**跳过**成员查询和 `avatarUrlsByUserIds`，直接返回 `[]`，禁止对 MySQL 发出 `IN ()`。
2. **一次**成员查询：`WHERE chain_id IN (...)`（或等价），在进程内按 `chainId` 分组，每组按 `joinedAt` 升序、`userId` 升序排序后切前 5，并计全组人数。
3. **一次** `avatarUrlsByUserIds`，参数是所有链预览项 `userId` 的并集，不得按链再签一轮。
4. `listMine` 禁止按链循环查成员，也禁止 `Promise.all(rows.map(attachPreview))` 这种按链并发。成员查询失败则整次 list/get/create/update/transfer 失败，禁止返回「链成功、`membersPreview: []` 且 `memberCount: 0`」的假空预览（有链则 `memberCount >= 1`）。

## 3. Web 链页眉

只改 `/chains/:id` 主栏眉，不改壳层顶栏。

```
[链名]  (头)(头)(头)  链接可看                         ···
  简介
```

**布局：**

- 头像贴在 **链名右侧**（同一行），不要推到最右。`···` 仍在 header 最右。
- 链名过长 `truncate`；头像簇与可见性标识 `shrink-0`。
- 简介仍在链名下方，左缘与链名对齐，不被头像挤到下一列。

**头像簇：**

- 尺寸 24px（与侧栏用户头像同一档），重叠 8px（`--space-2`）。重叠处用 1px `--bg` 描边，避免糊成一团。
- 数据源：`chain.membersPreview`。渲染全部预览项。
- `memberCount > membersPreview.length` 时，簇尾一枚 24px 圆：`+{memberCount - membersPreview.length}`。
- 无头像 URL：现有 `Avatar` 昵称首字。
- 头像与 `+N` 不可点进设置。

**浮层（hover；触控为点按，点空白关闭）：**

- 内容仅两行：昵称（主文）；角色人话（`roleLabel`：创建者 / 可记录 / 只看）。
- `+N` 浮层文案：`还有 N 人`（`N` 同上）。
- 浮层是无业务的 `src/ui/` 小组件（hover + 点按），本页只传入文案。

**可见性标识：**

| `chain.visibility` | 展示 |
|---|---|
| `private` | 不渲染 |
| `link` | Lucide `Link` +「链接可看」 |
| `public` | Lucide `Globe` +「公开」 |

标识只展示，不跳转、不复制链接。Web/App 创建链仍默认 `private`；设置里生成/吊销分享链接不得把 `visibility` 改成 `link` 或 `public`。手验 `link` / `public` 徽章时，用 `PATCH /api/chains/:id { visibility }` 种数据（现有 crud 测试已走这条路径），不要靠分享链接间接改。

**加载：** 预览在 `getChain` 响应里。链页现有骨架（尚无 `chain`）覆盖首屏；有 `chain` 后直接画，不另做一排头像骨架。

**组件放置：** 头像簇 + 标识放 `apps/web/src/pages/chain-home/`（与页同目录，不进 `src/ui/`），读 `ChainHomeService.chain`，不新建 Service，不打 `listMembers`。浮层壳体才进 `src/ui/`。

## 4. 刷新与事件

`ChainHomeService.loadChain` 已听 `chain:changed` 且同 `chainId` 会重拉。预览随 `ChainDto` 更新，链页无需第二套成员状态。

Web 设置里凡改变成员集合或预览中角色的动作，必须 `emit('chain:changed', { chainId, op: 'update' })`：

- 改角色
- 移除成员
- 转让

已有发射、保持：保存资料、退链、删链、接受邀请、建链。

`createInvite` 只往 `chain_invites` 插待接受邀请，不改 `membersPreview` / `memberCount`，不必为此新发事件。设置页不能直接把人写进 `chain_members`；加人发生在邀请接受页（接受成功已 emit）。

App 本轮不画此 UI，不必为改角色/移除补与 Web 相同的新发射。

`chain:changed` 仍是同页签前端事件，无服务端扇出（既有架构，不在本轮改）。

## 5. App 与其它端

`ChainDto` 是跨端类型。App 本轮不画头像簇，但所有构造 / 断言 `ChainDto` 的测试与赋值必须带上新字段，保证 `pnpm --filter @moment/app` typecheck 通过。

侧栏 `GET /api/chains` 会带上预览数据，本轮不展示。

## 6. 测试

**dto：** 新类型从 `packages/dto` 导出。响应是 interface，不新增 zod 运行时校验。

**server**（真实测试库，`--runInBand`，`resetDb` + `afterAll(closeDb)`）：扩 `apps/server/tests/chains/chains.crud.test.ts` 与 `chains.members.test.ts`。`joinedAt` 是秒级 `timestamp`，连加成员常落在同一秒；凡断言顺序的用例必须 **错开 `joinedAt`**（更新行上的时间），或在同一秒时按文档用 `userId` 作并列键，禁止依赖插入顺序碰运气。

每条预览项断言 `userId` / `nickname` / `role` / `avatarUrl`（未签出则为 `null`），且 JSON 无 `email`、无 `joinedAt`。

| 用例 | 断言 |
|---|---|
| `POST /chains` | `membersPreview` 仅创建者（`role: 'owner'`，`userId` / `nickname` 匹配），`memberCount === 1`，`membersPreview.length === 1` |
| 再加入 editor、viewer 后 `GET /chains/:id` | 错开三人 `joinedAt` 后，`membersPreview.map(m => m.userId)` 等于该序；三人 `role` / `nickname` 正确；`memberCount === 3`；`length === 3` |
| 同上后 `GET /chains`（两条链） | 本链项预览与人数同上；另一条未加人的链 `memberCount === 1` 且预览只有其创建者。禁止把 A 的成员挂到 B |
| 第 6 个成员加入后 `GET /chains/:id` | `length === 5`，`memberCount === 6`。被排除的是排序后第 6 人（最晚 `joinedAt`，并列则 `userId` 最大）。断言五个 `userId` 以及各自 `nickname` / `role` / `avatarUrl` |
| 仅发出邀请、尚未接受后 `GET /chains/:id` | 预览仍只有创建者，`memberCount === 1`，响应无邀请邮箱 |
| `PATCH visibility: 'link'` | `visibility === 'link'`；`memberCount` 与预览 `userId` 列表与 patch 前相同 |
| `POST /transfer`（三人链） | 响应里新主人 `role: 'owner'`，旧主人 `role: 'editor'`，三个 `userId` 仍在，`memberCount === 3` |
| 非成员 `GET` | 仍 404 `CHAIN_NOT_FOUND`，body 不出现该链 `membersPreview` |
| 未登录 | 仍 401 |

**api-client：** 现有路径测试不因新字段失败。不为预览单独立一份假契约测试。

**web：** typecheck + lint。手验 `/chains/:id`：

- 私密（默认创建）：只有头像，无徽章
- 用 `PATCH visibility: 'link'` 种数据后刷新：头像 +「链接可看」
- 用 `PATCH visibility: 'public'` 种数据后刷新：头像 +「公开」
- 生成或吊销一条分享链接后刷新：`visibility` 仍是种之前的值，徽章不因分享链接出现或消失
- hover / 点按：昵称 + 角色
- 6 人：`+N`，`N = memberCount - membersPreview.length`
- 设置里发出邀请后回到链页：预览人数不变
- 设置里改角色 / 移除 / 转让后回到链页：预览与角色与设置页一致

## 7. 与既有 spec 的关系

- `2026-08-17-web-c-end-redesign.md` §3 写「链页眉：链名 + 描述；不展示创建者」。本文在标题右侧增加**全员**头像与可见性，不再单独写「创建者」三字；角色只出现在头像浮层。冲突时本页眉交互听本文。
- `2026-08-16-web-product.md` 仍规定设置里不做 `visibility` 公开开关。本文只消费字段，不补开关；也不允许用分享链接去改 `visibility`。
- `2026-08-15-moment-design.md` 的 `visibility`：`private` / `link` / `public`。本文展示文案固定为「链接可看」/「公开」，不引入第四种状态。
