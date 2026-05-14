# Phase 5: 互动与异步（评论 + 表情 + 通知 + outbox worker + 推送）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec §3/§4/§5.4/§5.1 的互动与异步链路：评论（软删）与表情 reaction（upsert/硬删）四组端点、应用内通知（list/read）与 push_token 注册、`momentSerializer` 批量计数（评论数 / 按 emoji 分组的表情数 / 当前用户已点标记，严禁 N+1）、独立 worker 进程轮询 outbox（claim 租约 + FOR UPDATE SKIP LOCKED + 指数退避重试），通知扇出与 Expo Push 全部异步化——请求路径上不做任何扇出/推送。

**Architecture:** 在 Phase 1–4 之上新增四个模块：`src/comments`（评论 CRUD + 评论游标）、`src/reactions`（表情 upsert）、`src/notifications`（通知表读写 + 扇出助手 `fanoutNotifications`）、`src/push`（`PushService` 接口 + expo-server-sdk 实现 + mock 实现 + 可注入 factory，与 Phase 3 存储层同模式）；`src/worker/`（handlers + processor + 独立入口 `index.ts`，与 API 同 codebase 不同进程）。链权限一律走 `ChainPolicy.require`（CONVENTIONS §3.1，service 层反查链）；评论/表情路由按 CONVENTIONS §3.6 归属本计划。outbox 事件类型常量集中在 `src/outbox/types.ts`（CONVENTIONS §3.2）。

**Tech Stack:** 继承 Phase 1–4（Express + routing-controllers + TypeDI + Drizzle + mysql2、zod 3、Jest + supertest）。新增依赖：`expo-server-sdk` ^3.14.0（仅 worker/push 路径使用）。

**Spec:** `docs/superpowers/specs/2026-08-15-moment-design.md`（§3 comments/reactions/notifications/push_tokens 表、§4 Tags/Comments/Reactions/Notifications API、§5.4 outbox+worker、§5.1 计数、§5.7 删除语义）；`docs/superpowers/plans/CONVENTIONS.md` §3.1/§3.2/§3.4/§3.5/§3.6/§4。

## Global Constraints（本计划新增；通用约束继承 Phase 1）

- 评论 content：trim 后 1–1000 字；软删（`deleted_at`），评论作者或链 owner 可删（spec §1 owner「删除链内任何内容」）；软删后不出现在列表与计数。表情 emoji 白名单的唯一常量来源是 `@moment/dto` 的 `REACTION_EMOJIS`（10 个常用 emoji），白名单外 `400 VALIDATION_ERROR`（zod enum 拦截）；换表情 = upsert（`UNIQUE(moment_id, user_id)`），取消 = 硬删除（spec §5.7）。
- 评论列表分页方式（本计划显式决策）：**游标分页、升序（旧→新，契合评论流展示）**。游标 = base64url(JSON `{t: <createdAt epochMs>, i: <commentId>}`)，语义「取 (created_at, id) 严格晚于游标的下一页」，与 Phase 3/4 的 moments 游标同编码风格但独立实现于 `src/comments/comment-cursor.ts`——Phase 4「全仓无第二份游标实现」约束只针对 **moments 分页**，评论游标是另一资源域，不违反。`limit` 默认 20、1–50；解码失败 `400 INVALID_CURSOR`。通知列表同理（降序、`{t,i}` 游标）。
- 评论/表情/通知/push_tokens 均为**按资源 id 反查链或本人**的端点：service 层先查资源行，再 `ChainPolicy.require(userId, chainId, 'viewer')`（写操作 `'viewer'`——viewer 即可评论/点赞，spec §1 权限表）；非成员一律 `404 CHAIN_NOT_FOUND`（沿用 Phase 2 越权语义）。controller 内禁止手写角色判断。
- moment 已软删时：评论读写/表情操作一律 `410 MOMENT_DELETED`（spec §3「评论/表情随之不可见」，写路径同样拒绝）。
- 事务边界（spec §3）：POST comment = 插 comment + `emitOutbox(tx, 'comment.created', ...)` 单事务；PUT reaction = upsert + `emitOutbox(tx, 'reaction.created', ...)` 单事务。
- outbox 新增事件常量（CONVENTIONS §3.2，集中 `src/outbox/types.ts`）：`OUTBOX_COMMENT_CREATED = 'comment.created'`、`OUTBOX_REACTION_CREATED = 'reaction.created'`。payload 形状（worker 消费契约，Task 8 依赖）：
  - `comment.created`：`{ commentId, momentId, chainId, authorId }`
  - `reaction.created`：`{ momentId, chainId, userId, emoji }`（无 reactionId——upsert 覆盖旧行，id 不稳定，不进契约）
- worker 消费语义（spec §5.4）：单 worker 轮询，每 2s 一批（`WORKER_POLL_INTERVAL_MS`，默认 2000）最多 20 条（`WORKER_BATCH_SIZE`，默认 20）。**claim 采用「短事务 + 处理租约」**：事务内 `SELECT ... WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at<=now) ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED`，随即把选中行 `next_retry_at` 推到 now+60s（租约）后提交——处理（含 Expo Push 慢 IO）在事务外进行，不长期持锁；处理成功 → `status='done'` + `processed_at`；失败 → `attempts+1` 且 `next_retry_at = now + [1min,5min,15min,1h,4h][attempts-1]`，第 5 次失败（`attempts=5`）仍按 4h 档排重试，`attempts>5`（5 档退避全部用尽后仍失败）→ `status='failed'`——共 5 次重试，4h 档可达。worker 崩溃时租约 60s 后到期自动重投（at-least-once，handler 必须幂等：通知插行按类型区分去重键防御——`reaction.created` 为 `(user_id, type, momentId, emoji)`（**换表情 = 新通知**，与 Task 4「换表情才通知、语义由 payload 承载」一致），其余类型为 `(user_id, type, momentId)`；payload 无 momentId 的类型跳过去重直接插行）。
- 通知扇出规则（spec §5.4）：`moment.created` → 链全体成员（除作者）；`is_backfill=true` 时**仍插通知**（payload 标记 `backfill:true`）但**跳过 push**（本计划对 spec §5.6「补发不推送通知」的**澄清性决策**：补发的是历史时刻，打扰点在实时推送而非应用内列表，故只抑制 push；若后续产品要求完全不产生通知，改 handler 一处即可）；`comment.created` / `reaction.created` → 仅 moment 作者（行为人本人时完全跳过，不插行不发 push）。notifications.payload 存**标题快照**（链名、行为人昵称、moment/评论摘要），moment 被删后通知仍可展示、跳转时客户端优雅降级（spec §3）。
- PushService（CONVENTIONS §4「外部服务 mock 的注入点」）：接口在 `src/push/push-service.ts`，`expo.ts`（expo-server-sdk，批量分 chunk ≤100、随后取 receipts、`DeviceNotRegistered` 汇入 `invalidTokens`）与 `mock.ts` 两个实现；`factory.ts` 提供 `getPushService()/setPushService()`（与 Phase 3 `setStorageAdapter` 同模式）。`send()` 返回 `PushSendOutcome { invalidTokens: string[] }`，token 失效落库（`push_tokens.invalidated_at`）由 worker 侧完成——push 层不触 DB。
- worker 与 API 同 codebase 不同进程：`apps/server/src/worker/index.ts` 独立入口，package script `"worker": "tsx watch src/worker/index.ts"`；docker-compose 独立 service 属 Phase 8，本计划不动 compose。
- 新环境变量（同步 `src/config.ts` 与 `.env.example`）：`WORKER_POLL_INTERVAL_MS`(2000)、`WORKER_BATCH_SIZE`(20)、`EXPO_ACCESS_TOKEN`(可空字符串，Expo 推送凭据，缺省走匿名)。
- 新表必须扩展 `tests/helpers/db.ts` 的 `resetDb()`（外键逆序：push_tokens → notifications → reactions → comments → …）。触库测试 `beforeEach(resetDb)` + `afterAll(closeDb)`。
- `momentSerializer`/`serializeMoments` 仍是唯一序列化出口（CONVENTIONS §3.4）：本计划给 `MomentResponse` 增加计数三字段，`serializeMoments(rows, viewerId?)` 第二参可选——不传时 `myReaction: null`，Phase 3/4 既有调用零改动。
- 业务错误码（UPPER_SNAKE，新增）：`COMMENT_NOT_FOUND`(404)、`NOT_COMMENT_AUTHOR`(403)、`REACTION_NOT_FOUND`(404)、`INVALID_LIMIT`(400，评论/通知列表共用)、`INVALID_CURSOR`(400，复用)；复用 Phase 3 既有：`MOMENT_NOT_FOUND`(404)、`MOMENT_DELETED`(410)。不新增 `NOTIFICATION_NOT_FOUND`——markRead 对他人 id 静默忽略（不泄露他人通知存在性），无任何路径产生该错误码。

---

### Task 1: packages/dto — comments.ts + notifications.ts + moments.ts 计数字段（TDD）

**Files:**
- Test: `packages/dto/src/comments.test.ts`、`packages/dto/src/notifications.test.ts`
- Create: `packages/dto/src/comments.ts`、`packages/dto/src/notifications.ts`
- Modify: `packages/dto/src/moments.ts`（`MomentResponse` 加 `commentCount/reactions/myReaction`）
- Modify: `packages/dto/src/index.ts`（re-export 两行）

**Interfaces:**
- Consumes: Phase 3/4 的 `packages/dto/src/moments.ts`（`MomentResponse`）。
- Produces（Task 3–9 与 web/app 依赖，不得改名）:
  - `REACTION_EMOJIS`（`readonly ['👍','❤️','😂','😮','😢','🎉','🥰','👏','💪','🙏']`）/ `ReactionEmoji`
  - `reactionInputSchema` / `ReactionInput`（`{ emoji }`，白名单外拒绝）
  - `createCommentInputSchema` / `CreateCommentInput`（content trim 后 1–1000）
  - `CommentDto`、`CommentListResponse = { comments: CommentDto[]; nextCursor: string | null }`
  - `ReactionSummary = { emoji: string; count: number }`
  - `MomentResponse` 新增：`commentCount: number`、`reactions: ReactionSummary[]`、`myReaction: string | null`
  - `registerPushTokenSchema` / `RegisterPushTokenInput`（`{ expoToken: 16–128, platform: 'ios'|'android'|'web' }`）
  - `markNotificationsReadSchema` / `MarkNotificationsReadInput`（`{ ids: uuid[] 1–100 }`）
  - `NotificationDto`、`NotificationListResponse = { notifications: NotificationDto[]; nextCursor: string | null }`

- [ ] **Step 1: 写失败测试**

`packages/dto/src/comments.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REACTION_EMOJIS, createCommentInputSchema, reactionInputSchema } from './comments.js';

test('REACTION_EMOJIS 白名单 10 个、无重复', () => {
  assert.equal(REACTION_EMOJIS.length, 10);
  assert.equal(new Set(REACTION_EMOJIS).size, 10);
});

test('reactionInputSchema 只接受白名单 emoji', () => {
  assert.equal(reactionInputSchema.parse({ emoji: '👍' }).emoji, '👍');
  assert.throws(() => reactionInputSchema.parse({ emoji: '🔥' }));
  assert.throws(() => reactionInputSchema.parse({}));
});

test('createCommentInputSchema trim、1–1000 字', () => {
  assert.equal(createCommentInputSchema.parse({ content: '  好可爱  ' }).content, '好可爱');
  assert.throws(() => createCommentInputSchema.parse({ content: '   ' }));
  assert.throws(() => createCommentInputSchema.parse({ content: 'x'.repeat(1001) }));
  assert.ok(createCommentInputSchema.parse({ content: 'x'.repeat(1000) }));
});
```

`packages/dto/src/notifications.test.ts`：
```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markNotificationsReadSchema, registerPushTokenSchema } from './notifications.js';

test('registerPushTokenSchema 校验 expoToken 长度与 platform 枚举', () => {
  const token = `ExponentPushToken[${'a'.repeat(22)}]`;
  assert.equal(registerPushTokenSchema.parse({ expoToken: token, platform: 'ios' }).platform, 'ios');
  assert.throws(() => registerPushTokenSchema.parse({ expoToken: 'short', platform: 'ios' }));
  assert.throws(() => registerPushTokenSchema.parse({ expoToken: token, platform: 'harmony' }));
});

test('markNotificationsReadSchema：ids 1–100 个 uuid', () => {
  const ids = ['00000000-0000-4000-8000-000000000001'];
  assert.equal(markNotificationsReadSchema.parse({ ids }).ids.length, 1);
  assert.throws(() => markNotificationsReadSchema.parse({ ids: [] }));
  assert.throws(() => markNotificationsReadSchema.parse({ ids: ['not-uuid'] }));
  assert.throws(() =>
    markNotificationsReadSchema.parse({ ids: Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/dto test`
Expected: FAIL（`Cannot find module './comments.js'` / `Cannot find module './notifications.js'`）

- [ ] **Step 3: 实现**

`packages/dto/src/comments.ts`：
```ts
import { z } from 'zod';

/**
 * 表情白名单（spec §3 reactions.emoji varchar(16)）：所有端共享的唯一常量来源，
 * 白名单外 emoji 在 dto 层即被拒绝（VALIDATION_ERROR）。
 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🥰', '👏', '💪', '🙏'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const reactionInputSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});
export type ReactionInput = z.infer<typeof reactionInputSchema>;

export const createCommentInputSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

export interface CommentDto {
  id: string;
  momentId: string;
  author: { id: string; nickname: string };
  content: string;
  /** ISO 8601；软删评论不出现在列表，无 deletedAt 字段 */
  createdAt: string;
}

/** 评论列表分页（升序旧→新，游标 {t,i} 语义见 server 端 comment-cursor.ts） */
export interface CommentListResponse {
  comments: CommentDto[];
  nextCursor: string | null;
}

/** moment 上按 emoji 分组的表情计数（serializeMoments 批量产出） */
export interface ReactionSummary {
  emoji: string;
  count: number;
}
```

`packages/dto/src/notifications.ts`：
```ts
import { z } from 'zod';

export const pushPlatformSchema = z.enum(['ios', 'android', 'web']);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const registerPushTokenSchema = z.object({
  /** Expo push token，形如 ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]，≤128 字符（spec §3） */
  expoToken: z.string().min(16).max(128),
  platform: pushPlatformSchema,
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export interface NotificationDto {
  id: string;
  /** 通知类型（'moment.created' | 'comment.created' | 'reaction.created'，可扩展） */
  type: string;
  /** 标题快照（链名/行为人昵称/摘要等，spec §3：moment 删除后仍可展示） */
  payload: Record<string, unknown>;
  /** ISO 8601，未读为 null */
  readAt: string | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationDto[];
  nextCursor: string | null;
}
```

`packages/dto/src/moments.ts` 修改点（两处增量）：
1. import 区加：
```ts
import type { ReactionSummary } from './comments.js';
```
2. `MomentResponse` 接口追加三个字段（Phase 5 计数，spec §5.1）：
```ts
  /** 未软删评论数（批量 GROUP BY 产出） */
  commentCount: number;
  /** 按 emoji 分组的表情计数 */
  reactions: ReactionSummary[];
  /** 当前请求用户在本 moment 上点的 emoji；未点/无 viewer 上下文为 null */
  myReaction: string | null;
```

`packages/dto/src/index.ts` 追加两行（保留既有行）：
```ts
export * from './comments.js';
export * from './notifications.js';
```

- [ ] **Step 4: 运行确认通过 + 构建**

Run: `pnpm --filter @moment/dto test && pnpm --filter @moment/dto build`
Expected: comments 3 + notifications 2 个新测试 PASS；既有 dto 测试保持 PASS；`dist/comments.d.ts`、`dist/notifications.d.ts` 生成。

- [ ] **Step 5: Commit**

```bash
git add packages/dto
git commit -m "feat(dto): 评论/表情/通知 schema 与 moment 计数字段"
```

---

### Task 2: comments / reactions / notifications / push_tokens 四表 + 迁移 + resetDb 扩展

**Files:**
- Create: `apps/server/src/db/schema/comments.ts`、`apps/server/src/db/schema/reactions.ts`、`apps/server/src/db/schema/notifications.ts`、`apps/server/src/db/schema/push-tokens.ts`
- Modify: `apps/server/src/db/schema.ts`（barrel 追加四行）
- Modify: `apps/server/tests/helpers/db.ts`（resetDb 扩展）
- Create: `apps/server/drizzle/000X_*.sql`（`drizzle-kit generate` 产物）

**Interfaces:**
- Consumes: Phase 2/3 的 `moments`/`users` 表对象。
- Produces（Task 3–9 依赖，不得改名）:
  - `comments` 表对象（列：`id/momentId/authorId/content/createdAt/deletedAt`）；`Comment`/`NewComment`
  - `reactions` 表对象（列：`id/momentId/userId/emoji/createdAt`；`UNIQUE(moment_id, user_id)`）；`Reaction`/`NewReaction`
  - `notifications` 表对象（列：`id/userId/type/payload/readAt/createdAt`；索引 `(user_id, read_at)`，spec §3）；`Notification`/`NewNotification`
  - `pushTokens` 表对象（列：`id/userId/expoToken/platform/lastSeenAt/invalidatedAt`；`expo_token` 唯一）；`PushToken`/`NewPushToken`
  - `resetDb()` 扩展后按外键逆序清空四张新表

- [ ] **Step 1: 写表定义**

`apps/server/src/db/schema/comments.ts`：
```ts
import { char, index, mysqlTable, text, timestamp } from 'drizzle-orm/mysql-core';
import { moments } from './moments.js';
import { users } from './users.js';

export const comments = mysqlTable(
  'comments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    authorId: char('author_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    // precision 3（毫秒）：与 JS Date/getTime()（毫秒）精度完全对齐。裸 timestamp 为 fsp=0 秒级（且四舍五入），同秒多行时 (created_at, id) 排序退化为随机 UUID 序——需要亚秒精度；但**不能用 6（微秒）**：游标编码 getTime() 只取到毫秒，SQL 的 gt/eq/ORDER BY 却用完整微秒值，同毫秒多行跨页会重复（JS Date 层取不回微秒，precision 6 无收益）
    createdAt: timestamp('created_at', { mode: 'date', precision: 3 }).notNull().defaultNow(),
    /** 软删（spec §5.7）：删除后不出现在列表与计数 */
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
  },
  (t) => [
    // 列表游标按 (created_at, id) 升序扫描
    index('idx_comments_moment_created').on(t.momentId, t.createdAt, t.id),
  ]
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
```

`apps/server/src/db/schema/reactions.ts`：
```ts
import { char, index, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { moments } from './moments.js';
import { users } from './users.js';

export const reactions = mysqlTable(
  'reactions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    momentId: char('moment_id', { length: 36 })
      .notNull()
      .references(() => moments.id),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    // 换表情 = upsert 依赖此唯一键（spec §3）
    uniqueIndex('uk_reactions_moment_user').on(t.momentId, t.userId),
    // 批量计数 GROUP BY(moment_id, emoji) 的支撑索引
    index('idx_reactions_moment').on(t.momentId),
  ]
);

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;
```

`apps/server/src/db/schema/notifications.ts`：
```ts
import { char, index, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const notifications = mysqlTable(
  'notifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** 通知类型（'moment.created' 等），维度可扩展（spec §5.4，为链免打扰预留） */
    type: varchar('type', { length: 32 }).notNull(),
    /** 标题快照（链名/昵称/摘要），资源删除后仍可展示（spec §3） */
    payload: json('payload').notNull(),
    readAt: timestamp('read_at', { mode: 'date' }),
    // precision 3（毫秒）：与游标编码 getTime()（毫秒）精度对齐，降序 (created_at, id) 游标比较/排序三者一致；不用 6 的理由同 comments.created_at 注释
    createdAt: timestamp('created_at', { mode: 'date', precision: 3 }).notNull().defaultNow(),
  },
  // 未读列表/未读数高频查询（spec §3）
  (t) => [index('idx_notifications_user_read').on(t.userId, t.readAt)]
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
```

`apps/server/src/db/schema/push-tokens.ts`：
```ts
import { char, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { users } from './users.js';

export const pushTokens = mysqlTable(
  'push_tokens',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id),
    /** Expo push token 全局唯一：同 token 换账号 = 重新绑定（upsert 改 user_id） */
    expoToken: varchar('expo_token', { length: 128 }).notNull(),
    platform: mysqlEnum('platform', ['ios', 'android', 'web']).notNull(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).notNull().defaultNow(),
    /** receipts 返回 DeviceNotRegistered 时置位，此后不再向该设备推送（spec §3） */
    invalidatedAt: timestamp('invalidated_at', { mode: 'date' }),
  },
  (t) => [
    uniqueIndex('uk_push_tokens_expo_token').on(t.expoToken),
    index('idx_push_tokens_user').on(t.userId),
  ]
);

export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;
```

`apps/server/src/db/schema.ts` 追加四行（保留既有行）：
```ts
export * from './schema/comments.js';
export * from './schema/reactions.js';
export * from './schema/notifications.js';
export * from './schema/push-tokens.js';
```

- [ ] **Step 2: 生成迁移并跑通**

确认 `apps/server/.env` 指向测试库后：
Run: `cd apps/server && pnpm migrate:generate && pnpm migrate`
Expected: 生成新 `drizzle/000X_*.sql`（含 `comments`、`reactions`、`notifications`、`push_tokens` 四表及上述索引/唯一键）；输出 `migrations applied`；测试库出现四张表。

- [ ] **Step 3: 扩展 resetDb**

`apps/server/tests/helpers/db.ts`：import 区把四张新表并入既有 schema import；`resetDb()` 函数体**最前面**（第一个既有 `delete` 之前）插入四行——push_tokens/notifications 只依赖 users，comments/reactions 依赖 moments，先于 moments/users 清理均安全：
```ts
  await db.delete(pushTokens);
  await db.delete(notifications);
  await db.delete(reactions);
  await db.delete(comments);
```

- [ ] **Step 4: 全量回归**

Run: `pnpm --filter @moment/server test`
Expected: 既有测试全部 PASS（globalSetup 重跑迁移；resetDb 新增 delete 不影响既有用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db apps/server/drizzle apps/server/tests/helpers/db.ts
git commit -m "feat(server): comments/reactions/notifications/push_tokens 四表与迁移"
```

---

### Task 3: 评论 API（GET/POST /api/moments/:id/comments + DELETE /api/comments/:id，TDD）

**Files:**
- Modify: `apps/server/src/outbox/types.ts`（Phase 3 Task 4 已创建该文件；本 Task 整体替换，保留既有 `OUTBOX_MOMENT_CREATED`/`OUTBOX_MOMENT_DELETED`，追加 `OUTBOX_COMMENT_CREATED`/`OUTBOX_REACTION_CREATED`）
- Create: `apps/server/src/comments/comment-cursor.ts`、`apps/server/src/comments/comment.service.ts`、`apps/server/src/comments/comments.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 加 `CommentsController`）
- Test: `apps/server/tests/comments/comments.test.ts`

**Interfaces:**
- Consumes: Task 1 dto、Task 2 `comments` 表、`emitOutbox`/`DbTx`（CONVENTIONS §3.2）、`ChainPolicy.require`（CONVENTIONS §3.1）、Phase 4 `tests/helpers/fixtures.ts`（`registerUser/createChain/addMember/insertMoment/app`）。
- Produces（Task 8 worker 依赖 `comment.created` 事件契约，不得改名）:
  - `OUTBOX_COMMENT_CREATED = 'comment.created'`（追加进 `OutboxType` 联合）
  - `encodeCommentCursor(t: number, i: string): string` / `decodeCommentCursor(raw: string): { t: number; i: string }`（失败抛 `BadRequestError('INVALID_CURSOR')`）
  - `class CommentService`（`@Service()`，构造注入 `ChainPolicy`）：
    - `list(userId: string, momentId: string, query: { cursor?: string; limit?: string }): Promise<CommentListResponse>`（moment 可见即可读，viewer+；升序；软删/moment 已删同链内语义见下）
    - `create(userId: string, momentId: string, input: CreateCommentInput): Promise<CommentDto>`（viewer+；事务：插 comment + emitOutbox(comment.created)）
    - `remove(userId: string, commentId: string): Promise<void>`（评论作者或链 owner；软删）
  - HTTP：`GET /api/moments/:id/comments?cursor=&limit=`（200）、`POST /api/moments/:id/comments`（201）、`DELETE /api/comments/:id`（204）

- [ ] **Step 1: 扩展 outbox 类型常量（先于测试，测试要引用常量）**

`apps/server/src/outbox/types.ts`（整体替换；保留 Phase 3 既有常量，追加两个——`reaction.created` 一并加上，Task 4 只消费不重复改文件）：
```ts
/** outbox 事件类型常量集中地（CONVENTIONS §3.2）：后续 Phase 在此追加。 */
export const OUTBOX_MOMENT_CREATED = 'moment.created';
export const OUTBOX_MOMENT_DELETED = 'moment.deleted';
export const OUTBOX_COMMENT_CREATED = 'comment.created';
export const OUTBOX_REACTION_CREATED = 'reaction.created';

export type OutboxType =
  | typeof OUTBOX_MOMENT_CREATED
  | typeof OUTBOX_MOMENT_DELETED
  | typeof OUTBOX_COMMENT_CREATED
  | typeof OUTBOX_REACTION_CREATED;
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/comments/comments.test.ts`：
```ts
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { comments, outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** owner + viewer + outsider 三人场景与一条 owner 的 moment。 */
async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
  return { owner, viewer, outsider, chainId, momentId };
}

describe('POST /api/moments/:id/comments', () => {
  it('viewer 可评论：201 落库，同事务 emitOutbox(comment.created)', async () => {
    const { viewer, momentId, chainId } = await setup();
    const res = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: '  好可爱！ ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      momentId,
      author: { id: viewer.id, nickname: expect.any(String) },
      content: '好可爱！',
    });

    const [event] = await db.select().from(outbox).where(eq(outbox.type, 'comment.created'));
    expect(event.payload).toEqual({
      commentId: res.body.id,
      momentId,
      chainId,
      authorId: viewer.id,
    });
  });

  it('未登录 401；空 content 400 VALIDATION_ERROR；超 1000 字 400', async () => {
    const { viewer, momentId } = await setup();
    expect((await request(app).post(`/api/moments/${momentId}/comments`).send({ content: 'x' })).status).toBe(401);
    const empty = await request(app).post(`/api/moments/${momentId}/comments`).set(auth(viewer.token)).send({ content: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    const tooLong = await request(app).post(`/api/moments/${momentId}/comments`).set(auth(viewer.token)).send({ content: 'x'.repeat(1001) });
    expect(tooLong.status).toBe(400);
  });

  it('非链成员 404 CHAIN_NOT_FOUND；moment 不存在 404；moment 已软删 410 MOMENT_DELETED', async () => {
    const { viewer, outsider, momentId } = await setup();
    const stranger = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(outsider.token))
      .send({ content: '路过' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');

    const missing = await request(app)
      .post('/api/moments/00000000-0000-4000-8000-000000000000/comments')
      .set(auth(viewer.token))
      .send({ content: 'x' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('MOMENT_NOT_FOUND');

    const { moments } = await import('../../src/db/schema.js');
    await db.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, momentId));
    const gone = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: 'x' });
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('MOMENT_DELETED');
  });
});

describe('GET /api/moments/:id/comments', () => {
  it('viewer 可读；升序（旧→新）；软删评论不出现；翻页不丢不重', async () => {
    const { owner, viewer, momentId } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/moments/${momentId}/comments`)
        .set(auth(owner.token))
        .send({ content: `c-${i}` });
      ids.push(res.body.id as string);
    }
    // 软删第 2 条
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, ids[1]));

    const first = await request(app).get(`/api/moments/${momentId}/comments?limit=2`).set(auth(viewer.token));
    expect(first.status).toBe(200);
    expect(first.body.comments.map((c: { id: string }) => c.id)).toEqual([ids[0], ids[2]]);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app)
      .get(`/api/moments/${momentId}/comments?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set(auth(viewer.token));
    expect(second.body.comments.map((c: { id: string }) => c.id)).toEqual([ids[3], ids[4]]);
    expect(second.body.nextCursor).toBeNull();

    // 非成员 404；坏游标 400 INVALID_CURSOR
    const outsider = await registerUser();
    expect((await request(app).get(`/api/moments/${momentId}/comments`).set(auth(outsider.token))).status).toBe(404);
    const bad = await request(app)
      .get(`/api/moments/${momentId}/comments?cursor=${encodeURIComponent('!!!')}`)
      .set(auth(viewer.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('DELETE /api/comments/:id', () => {
  it('评论作者可删（软删）；链 owner 可删他人评论；普通成员删他人 403 NOT_COMMENT_AUTHOR', async () => {
    const { owner, viewer, momentId, chainId } = await setup();
    const mine = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: 'viewer 的评论' });
    expect((await request(app).delete(`/api/comments/${mine.body.id}`).set(auth(viewer.token))).status).toBe(204);
    const [row] = await db.select().from(comments).where(eq(comments.id, mine.body.id));
    expect(row.deletedAt).not.toBeNull();

    const others = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: '又一条' });
    expect((await request(app).delete(`/api/comments/${others.body.id}`).set(auth(owner.token))).status).toBe(204);

    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const byOwner = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(owner.token))
      .send({ content: 'owner 的评论' });
    const denied = await request(app).delete(`/api/comments/${byOwner.body.id}`).set(auth(editor.token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('NOT_COMMENT_AUTHOR');
  });

  it('不存在 404 COMMENT_NOT_FOUND；非链成员 404 CHAIN_NOT_FOUND', async () => {
    const { owner, outsider, momentId } = await setup();
    const created = await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(owner.token))
      .send({ content: 'x' });
    const nf = await request(app).delete('/api/comments/00000000-0000-4000-8000-000000000000').set(auth(owner.token));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('COMMENT_NOT_FOUND');
    const stranger = await request(app).delete(`/api/comments/${created.body.id}`).set(auth(outsider.token));
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');
  });
});

describe('outbox 原子性', () => {
  it('评论事务与 outbox 同生共死（回滚后两表皆空）', async () => {
    const { owner, momentId } = await setup();
    // 走真实接口成功路径建立对照后，直接验证表级原子性：用事务回滚 emitOutbox
    const { emitOutbox } = await import('../../src/outbox/outbox.js');
    const { OUTBOX_COMMENT_CREATED } = await import('../../src/outbox/types.js');
    await expect(
      db.transaction(async (tx) => {
        await emitOutbox(tx, OUTBOX_COMMENT_CREATED, { commentId: 'x', momentId, chainId: 'y', authorId: 'z' });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    const rows = await db.select().from(outbox).where(and(eq(outbox.type, 'comment.created')));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- comments`
Expected: FAIL（`Cannot find module '../../src/comments/comment.service.js'` 或路由 404）

- [ ] **Step 4: 实现 comment-cursor.ts + comment.service.ts + comments.controller.ts**

`apps/server/src/comments/comment-cursor.ts`：
```ts
import { BadRequestError } from 'routing-controllers';

/** 评论游标：base64url(JSON {t: <createdAt epochMs>, i: <commentId>})，语义「(created_at,id) 严格晚于」 */
export function encodeCommentCursor(t: number, i: string): string {
  return Buffer.from(JSON.stringify({ t, i }), 'utf8').toString('base64url');
}

export function decodeCommentCursor(raw: string): { t: number; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const p = parsed as { t?: unknown; i?: unknown };
  if (typeof p.t !== 'number' || !Number.isSafeInteger(p.t) || typeof p.i !== 'string' || p.i.length === 0) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { t: p.t, i: p.i };
}
```

`apps/server/src/comments/comment.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import type { CommentDto, CommentListResponse, CreateCommentInput } from '@moment/dto';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { comments, moments, users, type Comment, type Moment } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_COMMENT_CREATED } from '../outbox/types.js';
import { decodeCommentCursor, encodeCommentCursor } from './comment-cursor.js';

@Service()
export class CommentService {
  constructor(private readonly policy: ChainPolicy) {}

  /** 取可见且未软删的 moment：不存在/软删/无权限的错误语义集中在此（Phase 5 Global Constraints）。 */
  private async requireVisibleMoment(userId: string, momentId: string): Promise<Moment> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    return m;
  }

  /** 评论列表：moment 可见即可读（viewer+），升序旧→新，软删评论不出现。 */
  async list(
    userId: string,
    momentId: string,
    query: { cursor?: string; limit?: string }
  ): Promise<CommentListResponse> {
    await this.requireVisibleMoment(userId, momentId);

    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new HttpError(400, 'INVALID_LIMIT');
      }
    }

    const conditions: SQL[] = [eq(comments.momentId, momentId), isNull(comments.deletedAt)];
    if (query.cursor !== undefined && query.cursor !== '') {
      const cur = decodeCommentCursor(query.cursor);
      const after = new Date(cur.t);
      // (created_at, id) 严格晚于游标：时间更大，或时间相等但 id 更大
      conditions.push(
        or(gt(comments.createdAt, after), and(eq(comments.createdAt, after), gt(comments.id, cur.i))) as SQL,
      );
    }

    const rows = await db
      .select({ comment: comments, author: { id: users.id, nickname: users.nickname } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      comments: page.map((r) => this.toDto(r.comment, r.author)),
      nextCursor:
        hasMore && last
          ? encodeCommentCursor(last.comment.createdAt.getTime(), last.comment.id)
          : null,
    };
  }

  /** viewer+ 可评论（spec §1）。事务：插 comment + emitOutbox(comment.created)（spec §3）。 */
  async create(userId: string, momentId: string, input: CreateCommentInput): Promise<CommentDto> {
    const m = await this.requireVisibleMoment(userId, momentId);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(comments).values({ id, momentId, authorId: userId, content: input.content });
      await emitOutbox(tx, OUTBOX_COMMENT_CREATED, {
        commentId: id,
        momentId,
        chainId: m.chainId,
        authorId: userId,
      });
    });
    const [row] = await db
      .select({ comment: comments, author: { id: users.id, nickname: users.nickname } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.id, id))
      .limit(1);
    return this.toDto(row.comment, row.author);
  }

  /** 软删：评论作者本人或链 owner（spec §1 owner 可删链内任何内容）。幂等（已删再删 204）。 */
  async remove(userId: string, commentId: string): Promise<void> {
    const [c] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    if (!c) throw new NotFoundError('COMMENT_NOT_FOUND');
    const role = await this.policy.require(userId, (await this.momentChainId(c.momentId)), 'viewer');
    if (c.deletedAt) return;
    if (role !== 'owner' && c.authorId !== userId) {
      throw new HttpError(403, 'NOT_COMMENT_AUTHOR');
    }
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
  }

  private async momentChainId(momentId: string): Promise<string> {
    const [m] = await db.select({ chainId: moments.chainId }).from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    return m.chainId;
  }

  private toDto(c: Comment, author: { id: string; nickname: string }): CommentDto {
    return {
      id: c.id,
      momentId: c.momentId,
      author,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
```

`apps/server/src/comments/comments.controller.ts`：
```ts
import {
  createCommentInputSchema,
  type CommentDto,
  type CommentListResponse,
  type UserProfile,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
  QueryParam,
} from 'routing-controllers';
import { Service } from 'typedi';
import { CommentService } from './comment.service.js';

/** 按 moment id 反查链：service 层 ChainPolicy（CONVENTIONS §3.1）。viewer 即可评论/读取（spec §1）。 */
@JsonController()
@Service()
export class CommentsController {
  constructor(private readonly commentService: CommentService) {}

  @Get('/moments/:id/comments')
  @Authorized()
  list(
    @Param('id') momentId: string,
    @CurrentUser() user: UserProfile,
    @QueryParam('cursor') cursor: string | undefined,
    @QueryParam('limit') limit: string | undefined
  ): Promise<CommentListResponse> {
    return this.commentService.list(user.id, momentId, { cursor, limit });
  }

  @Post('/moments/:id/comments')
  @Authorized()
  @HttpCode(201)
  create(
    @Param('id') momentId: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<CommentDto> {
    return this.commentService.create(user.id, momentId, createCommentInputSchema.parse(body));
  }

  @Delete('/comments/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') commentId: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.commentService.remove(user.id, commentId);
  }
}
```

`apps/server/src/app.ts` 修改点：import 区加：
```ts
import { CommentsController } from './comments/comments.controller.js';
```
`controllers: [...]` 数组追加 `CommentsController`（保留既有项）。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: comments 7 个用例 PASS；既有全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): 评论 API（列表游标/创建+outbox/软删权限）"
```

---

### Task 4: 表情 API（PUT / DELETE /api/moments/:id/reaction，TDD）

**Files:**
- Create: `apps/server/src/reactions/reaction.service.ts`、`apps/server/src/reactions/reactions.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 加 `ReactionsController`）
- Test: `apps/server/tests/reactions/reactions.test.ts`

**Interfaces:**
- Consumes: Task 1 dto（`reactionInputSchema`/`REACTION_EMOJIS`）、Task 2 `reactions` 表、Task 3 已扩展的 `OUTBOX_REACTION_CREATED`、`ChainPolicy`、fixtures。
- Produces:
  - `class ReactionService`（`@Service()`，构造注入 `ChainPolicy`）：
    - `set(userId: string, momentId: string, input: ReactionInput): Promise<void>`（viewer+；upsert `UNIQUE(moment_id,user_id)`，换表情覆盖；事务：upsert + `emitOutbox(tx, 'reaction.created', { momentId, chainId, userId, emoji })`）
    - `remove(userId: string, momentId: string): Promise<void>`（硬删；未点过 → `404 REACTION_NOT_FOUND`）
  - HTTP：`PUT /api/moments/:id/reaction`（204）、`DELETE /api/moments/:id/reaction`（204）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/reactions/reactions.test.ts`：
```ts
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox, reactions } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
  return { owner, viewer, outsider, chainId, momentId };
}

describe('PUT /api/moments/:id/reaction', () => {
  it('viewer 可点赞：upsert 落库 + 同事务 emitOutbox(reaction.created)', async () => {
    const { viewer, momentId, chainId } = await setup();
    const res = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '🎉' });
    expect(res.status).toBe(204);

    const [row] = await db.select().from(reactions).where(eq(reactions.momentId, momentId));
    expect(row.userId).toBe(viewer.id);
    expect(row.emoji).toBe('🎉');

    const [event] = await db.select().from(outbox).where(eq(outbox.type, 'reaction.created'));
    expect(event.payload).toEqual({ momentId, chainId, userId: viewer.id, emoji: '🎉' });
  });

  it('换表情 = upsert 覆盖（不新增行）；再点同一表情幂等但每次都 emit 事件（换表情才通知语义由 payload 承载）', async () => {
    const { viewer, momentId } = await setup();
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '👍' });
    const switched = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '❤️' });
    expect(switched.status).toBe(204);

    const rows = await db.select().from(reactions).where(eq(reactions.momentId, momentId));
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe('❤️');
    const events = await db.select().from(outbox).where(eq(outbox.type, 'reaction.created'));
    expect(events).toHaveLength(2);
  });

  it('白名单外 emoji 400 VALIDATION_ERROR；未登录 401；非成员 404；moment 软删 410', async () => {
    const { owner, viewer, outsider, momentId } = await setup();
    const bad = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '🔥' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    expect((await request(app).put(`/api/moments/${momentId}/reaction`).send({ emoji: '👍' })).status).toBe(401);

    const stranger = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(outsider.token)).send({ emoji: '👍' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('CHAIN_NOT_FOUND');

    const { moments } = await import('../../src/db/schema.js');
    await db.update(moments).set({ deletedAt: new Date() }).where(eq(moments.id, momentId));
    const gone = await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(owner.token)).send({ emoji: '👍' });
    expect(gone.status).toBe(410);
    expect(gone.body.error.code).toBe('MOMENT_DELETED');
  });
});

describe('DELETE /api/moments/:id/reaction', () => {
  it('取消 = 硬删；未点过 404 REACTION_NOT_FOUND', async () => {
    const { viewer, momentId } = await setup();
    const none = await request(app).delete(`/api/moments/${momentId}/reaction`).set(auth(viewer.token));
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe('REACTION_NOT_FOUND');

    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '👏' });
    const res = await request(app).delete(`/api/moments/${momentId}/reaction`).set(auth(viewer.token));
    expect(res.status).toBe(204);
    expect(await db.select().from(reactions).where(and(eq(reactions.momentId, momentId)))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- reactions`
Expected: FAIL（`/api/moments/:id/reaction` 404）

- [ ] **Step 3: 实现**

`apps/server/src/reactions/reaction.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ReactionInput } from '@moment/dto';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { db } from '../db/index.js';
import { moments, reactions, type Moment } from '../db/schema.js';
import { emitOutbox } from '../outbox/outbox.js';
import { OUTBOX_REACTION_CREATED } from '../outbox/types.js';

@Service()
export class ReactionService {
  constructor(private readonly policy: ChainPolicy) {}

  private async requireVisibleMoment(userId: string, momentId: string): Promise<Moment> {
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
    if (!m) throw new NotFoundError('MOMENT_NOT_FOUND');
    await this.policy.require(userId, m.chainId, 'viewer');
    if (m.deletedAt) throw new HttpError(410, 'MOMENT_DELETED');
    return m;
  }

  /**
   * 点赞/换表情（viewer+，spec §1）：upsert UNIQUE(moment_id,user_id)。
   * 一条 `INSERT ... ON DUPLICATE KEY UPDATE`（drizzle `onDuplicateKeyUpdate`，tx 上同样可用）——
   * 并发双击/双端同点时先查后写会在 REPEATABLE READ 下双双 select 不到行、先后 insert 撞唯一索引，
   * 后者事务回滚表现为 500；ON DUPLICATE KEY UPDATE 在引擎层原子完成，无此竞态。
   * 事务：upsert + emitOutbox(reaction.created)（spec §3）。
   */
  async set(userId: string, momentId: string, input: ReactionInput): Promise<void> {
    const m = await this.requireVisibleMoment(userId, momentId);
    await db.transaction(async (tx) => {
      await tx
        .insert(reactions)
        .values({ id: randomUUID(), momentId, userId, emoji: input.emoji })
        .onDuplicateKeyUpdate({ set: { emoji: input.emoji } });
      await emitOutbox(tx, OUTBOX_REACTION_CREATED, {
        momentId,
        chainId: m.chainId,
        userId,
        emoji: input.emoji,
      });
    });
  }

  /** 取消点赞：硬删除（spec §5.7 reactions 硬删）。 */
  async remove(userId: string, momentId: string): Promise<void> {
    await this.requireVisibleMoment(userId, momentId);
    const deleted = await db
      .delete(reactions)
      .where(and(eq(reactions.momentId, momentId), eq(reactions.userId, userId)));
    if (deleted[0].affectedRows === 0) throw new NotFoundError('REACTION_NOT_FOUND');
  }
}
```

`apps/server/src/reactions/reactions.controller.ts`：
```ts
import { reactionInputSchema, type UserProfile } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Put,
  Delete,
} from 'routing-controllers';
import { Service } from 'typedi';
import { ReactionService } from './reaction.service.js';

@JsonController()
@Service()
export class ReactionsController {
  constructor(private readonly reactionService: ReactionService) {}

  @Put('/moments/:id/reaction')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  set(@Param('id') momentId: string, @Body() body: unknown, @CurrentUser() user: UserProfile): Promise<void> {
    return this.reactionService.set(user.id, momentId, reactionInputSchema.parse(body));
  }

  @Delete('/moments/:id/reaction')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') momentId: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.reactionService.remove(user.id, momentId);
  }
}
```

`apps/server/src/app.ts` 修改点：import 区加：
```ts
import { ReactionsController } from './reactions/reactions.controller.js';
```
`controllers: [...]` 数组追加 `ReactionsController`（保留既有项）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: reactions 4 个用例 PASS；既有全部 PASS（含 Task 3 comments）。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): 表情 reaction API（upsert/硬删 + outbox 事件）"
```

---

### Task 5: momentSerializer 批量计数扩展（评论数 / emoji 分组表情数 / myReaction，TDD）

**Files:**
- Modify: `apps/server/src/moments/moment-serializer.ts`（整体替换，完整代码见 Step 3）
- Modify: `apps/server/src/feed/feed.service.ts`（`serializeMoments(page.rows, userId)`）
- Modify: `apps/server/src/moments/moment.service.ts`（create/get/update 的序列化调用传 viewerId；`list` 追加可选第三参 `viewerId`）
- Modify: `apps/server/src/moments/moment.controller.ts`（链内列表方法传 `user.id` 作 viewerId——Step 1 第二用例断言 `listItem.myReaction === '👏'` 依赖此改动）
- Modify: `apps/server/tests/moments/moment-serializer.test.ts`（Phase 3 单测：三参调用改 extras 形式；计数断言并入）
- Test: `apps/server/tests/moments/moment-counts.test.ts`

**Interfaces:**
- Consumes: Task 1 dto（`ReactionSummary` 计数字段）、Task 2 `comments`/`reactions` 表、Phase 4 `serializeMoments`。
- Produces（Phase 6/7 客户端与 Phase 8 依赖，不得改名）:
  - `MomentInteractionCounts = { commentCount: number; reactions: ReactionSummary[]; myReaction: string | null }`
  - `serializeMoments(rows: Moment[], viewerId?: string | null): Promise<MomentResponse[]>`（第二参可选；未传时 `myReaction: null`——Phase 3/4 既有调用零改动）
  - `momentSerializer(m: MomentLike, extras: SerializerExtras): MomentResponse`（`SerializerExtras = { media: MediaLike[]; author: AuthorSummary; tags?: TagBrief[]; counts?: MomentInteractionCounts }`——本 Task 把 Phase 3 的 `(m, media, author)` 三参与 Phase 4 的 `extras.tags` 合并为单一 extras 对象，**全仓唯一生产代码调用方是 `serializeMoments`**（Phase 4 已把 create/update/get 统一改为事务提交后走 `serializeMoments`，无直接调用残留）；测试侧调用方 `tests/moments/moment-serializer.test.ts` 同步改 extras 形式（见 Step 4 第 3 点））

- [ ] **Step 1: 写失败测试**

`apps/server/tests/moments/moment-counts.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { comments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('moment 序列化计数（feed / 链内列表 / 详情统一）', () => {
  it('commentCount 不含软删评论；reactions 按 emoji 分组；myReaction 因请求者而异', async () => {
    const owner = await registerUser();
    const alice = await registerUser();
    const bob = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, alice.id, 'editor');
    await addMember(chainId, bob.id, 'viewer');
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });

    // 3 条评论，1 条软删 → 计数 2
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post(`/api/moments/${momentId}/comments`)
        .set(auth(alice.token))
        .send({ content: `c-${i}` });
      if (i === 1) {
        await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, res.body.id));
      }
    }
    // alice 点 ❤️、bob 点 ❤️、owner 点 🎉（owner 换过一次：👍 → 🎉，最终只有一个 🎉）
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(alice.token)).send({ emoji: '❤️' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(bob.token)).send({ emoji: '❤️' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(owner.token)).send({ emoji: '👍' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(owner.token)).send({ emoji: '🎉' });

    const fromAlice = await request(app).get(`/api/moments/${momentId}`).set(auth(alice.token));
    expect(fromAlice.status).toBe(200);
    expect(fromAlice.body.commentCount).toBe(2);
    // 不依赖 emoji 排序（MySQL collation 对 emoji 的顺序无契约）：按 count 降序后断言
    const reactionSummaries = [...fromAlice.body.reactions].sort(
      (a: { count: number }, b: { count: number }) => b.count - a.count
    );
    expect(reactionSummaries).toEqual([
      { emoji: '❤️', count: 2 },
      { emoji: '🎉', count: 1 },
    ]);
    expect(fromAlice.body.myReaction).toBe('❤️');

    const fromBob = await request(app).get(`/api/moments/${momentId}`).set(auth(bob.token));
    expect(fromBob.body.myReaction).toBe('❤️');

    const fromOwner = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(fromOwner.body.myReaction).toBe('🎉');

    // 未点表情的链外场景不可构造（非成员 404），用 feed 验证无互动时零值
    const empty = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date(Date.now() + 1000) });
    const feed = await request(app).get('/api/feed').set(auth(alice.token));
    const item = feed.body.moments.find((m: { id: string }) => m.id === empty);
    expect(item.commentCount).toBe(0);
    expect(item.reactions).toEqual([]);
    expect(item.myReaction).toBeNull();
  });

  it('feed 与链内列表同样携带计数（同一 serializeMoments 出口）', async () => {
    const owner = await registerUser();
    const viewer = await registerUser();
    const chainId = await createChain(owner.id);
    await addMember(chainId, viewer.id, 'viewer');
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await request(app)
      .post(`/api/moments/${momentId}/comments`)
      .set(auth(viewer.token))
      .send({ content: '一条' });
    await request(app).put(`/api/moments/${momentId}/reaction`).set(auth(viewer.token)).send({ emoji: '👏' });

    const feedItem = (
      await request(app).get('/api/feed').set(auth(viewer.token))
    ).body.moments.find((m: { id: string }) => m.id === momentId);
    expect(feedItem.commentCount).toBe(1);
    expect(feedItem.reactions).toEqual([{ emoji: '👏', count: 1 }]);
    expect(feedItem.myReaction).toBe('👏');

    const listItem = (
      await request(app).get(`/api/chains/${chainId}/moments`).set(auth(viewer.token))
    ).body.moments.find((m: { id: string }) => m.id === momentId);
    expect(listItem.commentCount).toBe(1);
    expect(listItem.myReaction).toBe('👏');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- moment-counts`
Expected: FAIL（`res.body.commentCount` 为 undefined——dto 已有字段但 serializer 未产出）

- [ ] **Step 3: 实现——改造后 serializer 完整代码**

`apps/server/src/moments/moment-serializer.ts`（整体替换）：
```ts
import type { AuthorSummary, MomentResponse, ReactionSummary, TagBrief } from '@moment/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { comments, media, momentTags, reactions, tags, users, type Moment } from '../db/schema.js';

/** serializer 依赖的最小形状（db 的 Moment/Media 行结构兼容，便于事务内未落库行复用） */
export interface MomentLike {
  id: string;
  chainId: string;
  authorId: string;
  type: 'text' | 'media' | 'video';
  content: string;
  happenedAt: Date;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: Date;
}

export interface MediaLike {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
}

/** 互动计数（spec §5.1：批量 GROUP BY 产出，禁止 N+1） */
export interface MomentInteractionCounts {
  commentCount: number;
  reactions: ReactionSummary[];
  /** 当前请求用户点的 emoji；无 viewer 上下文为 null */
  myReaction: string | null;
}

export interface SerializerExtras {
  media: MediaLike[];
  author: AuthorSummary;
  tags?: TagBrief[];
  counts?: MomentInteractionCounts;
}

/** moment → API 响应的唯一出口（CONVENTIONS §3.4）；media 只出稳定入口相对路径。 */
export function momentSerializer(m: MomentLike, extras: SerializerExtras): MomentResponse {
  return {
    id: m.id,
    chainId: m.chainId,
    author: extras.author,
    type: m.type,
    content: m.content,
    happenedAt: m.happenedAt.toISOString(),
    happenedTzOffset: m.happenedTzOffset,
    isBackfill: m.isBackfill,
    createdAt: m.createdAt.toISOString(),
    media: [...extras.media]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((x) => ({
        id: x.id,
        url: `/api/media/${x.id}`,
        mime: x.mime,
        width: x.width,
        height: x.height,
        duration: x.duration,
        sortOrder: x.sortOrder,
      })),
    tags: extras.tags ?? [],
    commentCount: extras.counts?.commentCount ?? 0,
    reactions: extras.counts?.reactions ?? [],
    myReaction: extras.counts?.myReaction ?? null,
  };
}

/**
 * 批量序列化：media / author / tags / 评论数 / 表情分组 / myReaction 全部一页一次
 * IN + GROUP BY 查出（spec §5.1，严禁 N+1）。viewerId 缺省时 myReaction 恒 null。
 */
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null
): Promise<MomentResponse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [mediaRows, authorRows, tagRows, commentRows, reactionRows, myRows] = await Promise.all([
    db.select().from(media).where(inArray(media.momentId, ids)),
    db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.authorId))])),
    db
      .select({ momentId: momentTags.momentId, id: tags.id, name: tags.name })
      .from(momentTags)
      .innerJoin(tags, eq(tags.id, momentTags.tagId))
      .where(inArray(momentTags.momentId, ids))
      .orderBy(asc(momentTags.momentId), asc(momentTags.tagId)),
    // 软删评论不计入（spec §5.7）
    db
      .select({ momentId: comments.momentId, count: sql<number>`count(*)` })
      .from(comments)
      .where(and(inArray(comments.momentId, ids), isNull(comments.deletedAt)))
      .groupBy(comments.momentId),
    db
      .select({ momentId: reactions.momentId, emoji: reactions.emoji, count: sql<number>`count(*)` })
      .from(reactions)
      .where(inArray(reactions.momentId, ids))
      .groupBy(reactions.momentId, reactions.emoji)
      .orderBy(asc(reactions.emoji)),
    viewerId
      ? db
          .select({ momentId: reactions.momentId, emoji: reactions.emoji })
          .from(reactions)
          .where(and(inArray(reactions.momentId, ids), eq(reactions.userId, viewerId)))
      : Promise.resolve([] as { momentId: string; emoji: string }[]),
  ]);

  const mediaBy = new Map<string, MediaLike[]>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    const list = mediaBy.get(m.momentId) ?? [];
    list.push(m);
    mediaBy.set(m.momentId, list);
  }
  const authorBy = new Map(authorRows.map((a) => [a.id, a]));
  const tagsBy = new Map<string, TagBrief[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.momentId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsBy.set(t.momentId, list);
  }
  const commentCountBy = new Map(commentRows.map((c) => [c.momentId, Number(c.count)]));
  const reactionBy = new Map<string, ReactionSummary[]>();
  for (const r of reactionRows) {
    const list = reactionBy.get(r.momentId) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.count) });
    reactionBy.set(r.momentId, list);
  }
  const myBy = new Map(myRows.map((r) => [r.momentId, r.emoji]));

  return rows.map((r) =>
    momentSerializer(r, {
      media: mediaBy.get(r.id) ?? [],
      author: authorBy.get(r.authorId) ?? { id: r.authorId, nickname: '' },
      tags: tagsBy.get(r.id) ?? [],
      counts: {
        commentCount: commentCountBy.get(r.id) ?? 0,
        reactions: reactionBy.get(r.id) ?? [],
        myReaction: myBy.get(r.id) ?? null,
      },
    })
  );
}
```

- [ ] **Step 4: 改造调用点（传 viewerId + 适配 extras 新签名）**

1. `apps/server/src/feed/feed.service.ts`：`serializeMoments(page.rows)` 改为：
```ts
    return { moments: await serializeMoments(page.rows, userId), nextCursor: page.nextCursor };
```
2. `apps/server/src/moments/moment.service.ts`：Phase 4 定稿形态为 create/update/get 均在事务提交后调用 `serializeMoments([...])[0]`（create/update 用事务返回的行，get 用查出的行），本 Task 在此基础上**只补第二参**，无需再改调用结构：
   - `get`：`serializeMoments([moment], userId)`。
   - `update`：`serializeMoments([updated], userId)`。
   - `create`：`serializeMoments([created], userId)`（`userId` 即请求用户 = 作者）。
   - `list`（链内列表）：Phase 4 定稿签名为 `list(chainId, query)`，内部 `serializeMoments(page.rows)` 不带 viewerId，`myReaction` 恒为 `null`——而链内列表同样要求本人视角（Step 1 第二用例 `listItem.myReaction === '👏'`、DoD「feed/链内列表/详情……本人视角正确」）。追加**可选第三参**保持契约向后兼容：
```ts
  async list(
    chainId: string,
    query: { cursor?: string; limit: number },
    viewerId?: string
  ): Promise<MomentListResponse> {
    // …queryMomentPage 调用不变…
    return { moments: await serializeMoments(page.rows, viewerId), nextCursor: page.nextCursor };
  }
```
   Run（确认无旧签名残留）: `grep -rn "momentSerializer(" apps/server/src | grep -v moment-serializer.ts || true`
   Expected: 零输出（create 已改为事务提交后走 `serializeMoments`，src 下除 moment-serializer.ts 自身外无任何直接调用——这是硬校验，有输出即改造未完成）。

3. `apps/server/tests/moments/moment-serializer.test.ts`（Phase 3 的序列化单测，tsconfig include 覆盖 tests，不改则编译失败；Phase 4 已把 Phase 3 的 `(m, media, author)` 三参调用迁到当时的 extras 形态，本 Task 再对齐最终签名）：所有调用统一为 `momentSerializer(m, { media, author })`；并补一组断言：不传 `counts` 时输出默认值 `commentCount: 0, reactions: [], myReaction: null`，不传 `tags` 时 `tags: []`（覆盖并入本 Task，无需另建文件）。

4. `apps/server/src/moments/moment.controller.ts`：链内列表方法（`GET /api/chains/:chainId/moments`，`@UseBefore(requireChainRole('viewer'))` 保持不变）签名补 `@CurrentUser() user: UserProfile` 参数（`CurrentUser`/`UserProfile` 该文件已 import，无新增 import），既有 service 调用追加第三参：
```ts
    return this.momentService.list(chainId, { cursor, limit }, user.id);
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: moment-counts 2 个用例 PASS；Phase 3/4 既有 moments/feed 测试全部 PASS（响应新增三个计数字段不破坏 `toMatchObject` 断言；若有 `toEqual` 全量断言期望对象，补上 `commentCount: 0, reactions: [], myReaction: null` / 相应值，属预期小改）。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): moment 序列化批量计数（评论数/表情分组/myReaction，无 N+1）"
```

---

### Task 6: PushService 接口 + expo 实现 + mock + factory + EXPO_ACCESS_TOKEN（TDD）

**Files:**
- Modify: `apps/server/package.json`（依赖 `expo-server-sdk`、script `worker`）
- Modify: `apps/server/src/config.ts`（加 `EXPO_ACCESS_TOKEN`）
- Modify: `apps/server/.env.example`
- Create: `apps/server/src/push/push-service.ts`、`apps/server/src/push/expo.ts`、`apps/server/src/push/mock.ts`、`apps/server/src/push/factory.ts`
- Test: `apps/server/tests/push/push.test.ts`

**Interfaces:**
- Consumes: `config`（Phase 1）。Expo 客户端以构造注入（`ExpoPushService(expo?: Expo)`），测试注入 fake，不触网（CONVENTIONS §4）。
- Produces（Task 8/9 worker 依赖，不得改名）:
  - `PushMessage = { to: string; title: string; body: string; data?: Record<string, unknown> }`
  - `PushSendOutcome = { invalidTokens: string[] }`
  - `PushService` 接口：`send(messages: PushMessage[]): Promise<PushSendOutcome>`（批量 ≤100/次自动分 chunk；票据/回执中的 `DeviceNotRegistered` token 汇入 `invalidTokens` 返回，**不触 DB**）
  - `ExpoPushService implements PushService`（expo-server-sdk）
  - `MockPushService implements PushService`（记录 `sent`、可配置 `invalidTokensToReport`/`failWith`）
  - `getPushService(): PushService`（单例，按 config 创建 ExpoPushService）、`setPushService(p: PushService | null): void`（测试注入点，与 Phase 3 `setStorageAdapter` 同模式）
  - `config.EXPO_ACCESS_TOKEN: string`（可空字符串，默认 `''`——Expo 推送无凭据也可用，有则带上）

- [ ] **Step 1: 依赖 + config + env 模板**

```bash
pnpm --filter @moment/server add expo-server-sdk@^3.14.0
```
`apps/server/package.json` 的 scripts 增加一行（Task 9 的 worker 入门用，此处一并加上）：
```json
    "worker": "tsx watch src/worker/index.ts",
```
`apps/server/src/config.ts` 的 `envSchema` 中（`PRESIGN_PUT_TTL_SECONDS` 行之后，保留 Phase 3 已有字段）追加：
```ts
  EXPO_ACCESS_TOKEN: z.string().default(''),
```
`apps/server/.env.example` 末尾追加：
```dotenv

# Expo Push（worker 进程使用；无凭据可留空，Expo 推送免费层匿名可用）
EXPO_ACCESS_TOKEN=
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/push/push.test.ts`：
```ts
import { Expo } from 'expo-server-sdk';
import { ExpoPushService } from '../../src/push/expo.js';
import { getPushService, setPushService } from '../../src/push/factory.js';
import { MockPushService } from '../../src/push/mock.js';
import type { PushMessage } from '../../src/push/push-service.js';

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const TOKEN_C = 'ExponentPushToken[cccccccccccccccccccccc]';

function msg(to: string, title = '时刻', body = '新动态'): PushMessage {
  return { to, title, body, data: { momentId: 'm-1' } };
}

function fakeExpo(): Expo {
  const calls = { sent: [] as PushMessage[][], receiptIds: [] as string[][] };
  const expo = {
    isExpoPushToken: (t: string) => t.startsWith('ExponentPushToken['),
    chunkPushNotifications: (messages: PushMessage[]) => {
      const chunks: PushMessage[][] = [];
      for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));
      return chunks;
    },
    sendPushNotificationsAsync: async (chunk: PushMessage[]) => {
      calls.sent.push(chunk);
      // ticket id 形如 DOSDUSD...；error ticket 直接携带 DeviceNotRegistered
      return chunk.map((m) => {
        if (m.to === TOKEN_B) {
          return { status: 'error', message: 'device not registered', details: { error: 'DeviceNotRegistered' } };
        }
        return { status: 'ok', id: `ticket-${m.to.slice(-6)}` };
      });
    },
    getPushNotificationReceiptsAsync: async (ids: string[]) => {
      calls.receiptIds.push(ids);
      return ids.map((id) => {
        if (id === `ticket-${TOKEN_C.slice(-6)}`) {
          return { id, status: 'error', message: 'device not registered', details: { error: 'DeviceNotRegistered' } };
        }
        return { id, status: 'ok' };
      });
    },
  };
  const wrapped = { ...expo, __calls: calls } as unknown as Expo & { __calls: typeof calls };
  return wrapped;
}

afterEach(() => setPushService(null));

describe('ExpoPushService', () => {
  it('批量发送：非 Expo token 静默丢弃；error ticket 的 DeviceNotRegistered 汇入 invalidTokens', async () => {
    const service = new ExpoPushService(fakeExpo());
    const outcome = await service.send([msg(TOKEN_A), msg(TOKEN_B), msg('garbage-token')]);
    expect(outcome.invalidTokens).toEqual([TOKEN_B]);
  });

  it('receipts 中的 DeviceNotRegistered 也汇入 invalidTokens', async () => {
    const service = new ExpoPushService(fakeExpo());
    const outcome = await service.send([msg(TOKEN_A), msg(TOKEN_C)]);
    expect(outcome.invalidTokens).toEqual([TOKEN_C]);
  });

  it('空消息数组直接返回空结果，不触 Expo', async () => {
    const expo = fakeExpo();
    const service = new ExpoPushService(expo);
    expect(await service.send([])).toEqual({ invalidTokens: [] });
  });
});

describe('MockPushService', () => {
  it('记录消息、返回配置的失效 token、可注入失败', async () => {
    const mock = new MockPushService();
    mock.invalidTokensToReport = [TOKEN_A];
    const outcome = await mock.send([msg(TOKEN_A), msg(TOKEN_B)]);
    expect(mock.sent).toHaveLength(2);
    expect(outcome.invalidTokens).toEqual([TOKEN_A]);

    mock.failWith = new Error('EXPO_DOWN');
    await expect(mock.send([msg(TOKEN_A)])).rejects.toThrow('EXPO_DOWN');
  });
});

describe('push factory', () => {
  it('默认单例；setPushService 注入后可替换、置 null 恢复', () => {
    const a = getPushService();
    expect(getPushService()).toBe(a);
    const mock = new MockPushService();
    setPushService(mock);
    expect(getPushService()).toBe(mock);
    setPushService(null);
    expect(getPushService()).not.toBe(mock);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- push`
Expected: FAIL（`Cannot find module '../../src/push/push-service.js'` 等）

- [ ] **Step 4: 实现**

`apps/server/src/push/push-service.ts`：
```ts
export interface PushMessage {
  /** Expo push token（ExponentPushToken[...]） */
  to: string;
  title: string;
  body: string;
  /** 客户端路由用（momentId 等） */
  data?: Record<string, unknown>;
}

/** send 结果：需要失效（DeviceNotRegistered）的 token 列表，落库由调用方完成。 */
export interface PushSendOutcome {
  invalidTokens: string[];
}

/** 推送出口（CONVENTIONS §4：外部服务 mock 注入点）。实现不得触 DB。 */
export interface PushService {
  send(messages: PushMessage[]): Promise<PushSendOutcome>;
}
```

`apps/server/src/push/expo.ts`：
```ts
import { Expo } from 'expo-server-sdk';
import { logger } from '../utils/logger.js';
import type { PushMessage, PushSendOutcome, PushService } from './push-service.js';

interface ExpoTicketLike {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}
interface ExpoReceiptLike {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** 最小 Expo 客户端形状（测试注入 fake 用；与 expo-server-sdk 的 Expo 方法子集兼容）。 */
export interface ExpoClientLike {
  isExpoPushToken(token: string): boolean;
  chunkPushNotifications(messages: unknown[]): unknown[][];
  sendPushNotificationsAsync(chunk: unknown[]): Promise<ExpoTicketLike[]>;
  getPushNotificationReceiptsAsync(ids: string[]): Promise<ExpoReceiptLike[]>;
}

/**
 * Expo Push 实现：批量 ≤100/chunk（SDK chunkPushNotifications 自动切），
 * 汇总 ticket 与 receipt 两级返回中的 DeviceNotRegistered → invalidTokens。
 * receipts 在发送后可能尚未就绪：best-effort 拉一次，未就绪/失败仅记日志，
 * 失效判定最终由后续批次重试收敛（token 继续报错会再次返回）。
 */
export class ExpoPushService implements PushService {
  /** expo：可注入的客户端（测试传 fake；默认 new Expo()，凭据在 factory 侧注入）。 */
  constructor(private readonly expo: ExpoClientLike = new Expo()) {}

  async send(messages: PushMessage[]): Promise<PushSendOutcome> {
    const invalidTokens = new Set<string>();
    if (messages.length === 0) return { invalidTokens: [] };

    const valid = messages.filter((m) => {
      if (this.expo.isExpoPushToken(m.to)) return true;
      logger.warn('skip non-expo push token', { to: m.to.slice(0, 24) });
      return false;
    });
    if (valid.length === 0) return { invalidTokens: [] };

    // to → 消息映射：ticket 不回带 token，用 ticket 对应 chunk 的顺序回查
    const chunks = this.expo.chunkPushNotifications(valid);
    const ticketIds: string[] = [];
    const idToToken = new Map<string, string>();
    for (const chunk of chunks) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const token = (chunk as PushMessage[])[i]?.to ?? '';
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered' && token) invalidTokens.add(token);
          else logger.warn('expo push ticket error', { ticket });
        } else if (ticket.id) {
          ticketIds.push(ticket.id);
          idToToken.set(ticket.id, token);
        }
      }
    }

    if (ticketIds.length > 0) {
      try {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(ticketIds);
        for (const r of receipts) {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' && r.id) {
            const token = idToToken.get(r.id);
            if (token) invalidTokens.add(token);
          }
        }
      } catch (err) {
        logger.warn('expo receipts fetch failed (best-effort)', err);
      }
    }
    return { invalidTokens: [...invalidTokens] };
  }
}
```

`apps/server/src/push/mock.ts`：
```ts
import type { PushMessage, PushSendOutcome, PushService } from './push-service.js';

/** 测试/本地开发用 mock：记录消息、可配置失效 token 与抛错。 */
export class MockPushService implements PushService {
  readonly sent: PushMessage[] = [];
  invalidTokensToReport: string[] = [];
  failWith?: Error;

  async send(messages: PushMessage[]): Promise<PushSendOutcome> {
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return { invalidTokens: [...this.invalidTokensToReport] };
  }
}
```

`apps/server/src/push/factory.ts`：
```ts
import { Expo } from 'expo-server-sdk';
import { config } from '../config.js';
import { ExpoPushService } from './expo.js';
import type { PushService } from './push-service.js';

let singleton: PushService | null = null;
let override: PushService | null = null;

export function getPushService(): PushService {
  if (override) return override;
  if (!singleton) {
    const expo = config.EXPO_ACCESS_TOKEN
      ? new Expo({ accessToken: config.EXPO_ACCESS_TOKEN })
      : new Expo();
    singleton = new ExpoPushService(expo);
  }
  return singleton;
}

/** 测试注入点（传 null 恢复单例）。严禁业务代码使用。 */
export function setPushService(p: PushService | null): void {
  override = p;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- push`
Expected: push 5 个用例 PASS；既有全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): PushService 接口与 expo/mock 实现及可注入 factory"
```

---

### Task 7: 通知 API（GET /api/notifications + POST /api/notifications/read）+ 设备注册（POST /api/devices/push-token，TDD）

**Files:**
- Create: `apps/server/src/notifications/types.ts`、`apps/server/src/notifications/notification.service.ts`、`apps/server/src/notifications/notifications.controller.ts`
- Create: `apps/server/src/devices/devices.controller.ts`
- Modify: `apps/server/src/app.ts`（controllers 加 `NotificationsController`、`DevicesController`）
- Test: `apps/server/tests/notifications/notifications.test.ts`、`apps/server/tests/devices/push-token.test.ts`

**Interfaces:**
- Consumes: Task 1 dto（`markNotificationsReadSchema`/`registerPushTokenSchema`/`NotificationDto`/`NotificationListResponse`）、Task 2 `notifications`/`pushTokens` 表。
- Produces（Task 8 依赖 `NOTIFICATION_*` 常量与 `NotificationService.fanoutNotifications`，不得改名）:
  - `NOTIFICATION_MOMENT_CREATED = 'moment.created'`、`NOTIFICATION_COMMENT_CREATED = 'comment.created'`、`NOTIFICATION_REACTION_CREATED = 'reaction.created'`（`src/notifications/types.ts`；`NotificationType` 联合）
  - `class NotificationService`（`@Service()`）：
    - `list(userId: string, query: { unread?: string; cursor?: string; limit?: string }): Promise<NotificationListResponse>`（仅本人；降序 created_at, id；`unread=true` 只返回 `read_at IS NULL`；`{t,i}` 游标同 base64url 风格，语义「(created_at,id) 严格早于」）
    - `markRead(userId: string, input: MarkNotificationsReadInput): Promise<void>`（仅本人的通知置 `read_at`；混入他人 id 时他人的行**静默不动**，不报错）
    - `fanoutNotifications(deps: { push: PushService }, args: { userIds: string[]; type: NotificationType; payload: Record<string, unknown>; push: boolean }): Promise<void>`（批量插 notifications + 对有有效 push_token 的用户批量推送 + `invalidTokens` 置 `invalidated_at`；`push=false` 只插行）
  - HTTP：`GET /api/notifications?unread=&cursor=&limit=`、`POST /api/notifications/read`（204）、`POST /api/devices/push-token`（204，upsert `expo_token` 唯一键 + 刷 `last_seen_at`）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/notifications/notifications.test.ts`：
```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { notifications } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { registerUser, app } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seed(userId: string, n: number, readFirst = 0): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    ids.push(id);
    await db.insert(notifications).values({
      id,
      userId,
      type: 'moment.created',
      payload: { chainName: '链', actorNickname: 'n', summary: 's' },
      readAt: i < readFirst ? new Date() : null,
      // 显式 createdAt 逐条 +1ms：默认值仅毫秒级递增，同毫秒两行会让 (created_at, id) 降序退化为随机 UUID 序、顺序断言偶发失败
      createdAt: new Date(Date.now() + i),
    });
  }
  return ids;
}

describe('GET /api/notifications', () => {
  it('仅本人、降序、unread 过滤、游标翻页', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const ids = await seed(alice.id, 4, 1); // 第 1 条已读
    await seed(bob.id, 2);

    const page1 = await request(app).get('/api/notifications?limit=2').set(auth(alice.token));
    expect(page1.status).toBe(200);
    // 降序（新→旧），bob 的不出现
    expect(page1.body.notifications.map((n: { id: string }) => n.id)).toEqual([ids[3], ids[2]]);
    expect(page1.body.notifications[0].payload).toEqual({ chainName: '链', actorNickname: 'n', summary: 's' });

    const page2 = await request(app)
      .get(`/api/notifications?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set(auth(alice.token));
    expect(page2.body.notifications.map((n: { id: string }) => n.id)).toEqual([ids[1], ids[0]]);
    expect(page2.body.nextCursor).toBeNull();

    const unread = await request(app).get('/api/notifications?unread=true').set(auth(alice.token));
    expect(unread.body.notifications).toHaveLength(3);

    // 坏游标 400
    const bad = await request(app)
      .get(`/api/notifications?cursor=${encodeURIComponent('!!!')}`)
      .set(auth(alice.token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });

  it('未登录 401', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});

describe('POST /api/notifications/read', () => {
  it('仅本人的置已读；他人 id 静默不动', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const aliceIds = await seed(alice.id, 2);
    const bobIds = await seed(bob.id, 1);

    const res = await request(app)
      .post('/api/notifications/read')
      .set(auth(alice.token))
      .send({ ids: [aliceIds[0], bobIds[0]] });
    expect(res.status).toBe(204);

    const [a0] = await db.select().from(notifications).where(eq(notifications.id, aliceIds[0]));
    expect(a0.readAt).not.toBeNull();
    const [a1] = await db.select().from(notifications).where(eq(notifications.id, aliceIds[1]));
    expect(a1.readAt).toBeNull();
    const [b0] = await db.select().from(notifications).where(eq(notifications.id, bobIds[0]));
    expect(b0.readAt).toBeNull();
  });

  it('空 ids 400 VALIDATION_ERROR', async () => {
    const alice = await registerUser();
    const res = await request(app).post('/api/notifications/read').set(auth(alice.token)).send({ ids: [] });
    expect(res.status).toBe(400);
  });
});
```

`apps/server/tests/devices/push-token.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { pushTokens } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

const TOKEN = 'ExponentPushToken[dddddddddddddddddddddd]';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /api/devices/push-token', () => {
  it('注册：upsert + last_seen_at 刷新；同 token 重复注册不增行', async () => {
    const alice = await registerUser();
    const first = await request(app)
      .post('/api/devices/push-token')
      .set(auth(alice.token))
      .send({ expoToken: TOKEN, platform: 'ios' });
    expect(first.status).toBe(204);
    expect(await db.select().from(pushTokens)).toHaveLength(1);

    const second = await request(app)
      .post('/api/devices/push-token')
      .set(auth(alice.token))
      .send({ expoToken: TOKEN, platform: 'ios' });
    expect(second.status).toBe(204);
    expect(await db.select().from(pushTokens)).toHaveLength(1);
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.expoToken, TOKEN));
    expect(row.userId).toBe(alice.id);
    expect(row.invalidatedAt).toBeNull();
    expect(row.lastSeenAt).toBeTruthy();
  });

  it('同 token 换账号 = 重新绑定（user_id 改写）', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await request(app).post('/api/devices/push-token').set(auth(alice.token)).send({ expoToken: TOKEN, platform: 'android' });
    await request(app).post('/api/devices/push-token').set(auth(bob.token)).send({ expoToken: TOKEN, platform: 'android' });
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.expoToken, TOKEN));
    expect(row.userId).toBe(bob.id);
    expect(await db.select().from(pushTokens)).toHaveLength(1);
  });

  it('失效后重新注册复活（invalidated_at 清空）', async () => {
    const alice = await registerUser();
    await request(app).post('/api/devices/push-token').set(auth(alice.token)).send({ expoToken: TOKEN, platform: 'ios' });
    await db.update(pushTokens).set({ invalidatedAt: new Date() }).where(eq(pushTokens.expoToken, TOKEN));
    await request(app).post('/api/devices/push-token').set(auth(alice.token)).send({ expoToken: TOKEN, platform: 'ios' });
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.expoToken, TOKEN));
    expect(row.invalidatedAt).toBeNull();
  });

  it('非法 platform / 短 token 400；未登录 401', async () => {
    const alice = await registerUser();
    const bad = await request(app)
      .post('/api/devices/push-token')
      .set(auth(alice.token))
      .send({ expoToken: TOKEN, platform: 'harmony' });
    expect(bad.status).toBe(400);
    expect((await request(app).post('/api/devices/push-token').send({ expoToken: TOKEN, platform: 'ios' })).status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- notifications devices`
Expected: FAIL（`/api/notifications`、`/api/devices/push-token` 404）

- [ ] **Step 3: 实现**

`apps/server/src/notifications/types.ts`：
```ts
/** 通知类型（spec §5.4：维度可扩展，为链免打扰预留；不与 outbox 类型耦合） */
export const NOTIFICATION_MOMENT_CREATED = 'moment.created';
export const NOTIFICATION_COMMENT_CREATED = 'comment.created';
export const NOTIFICATION_REACTION_CREATED = 'reaction.created';

export type NotificationType =
  | typeof NOTIFICATION_MOMENT_CREATED
  | typeof NOTIFICATION_COMMENT_CREATED
  | typeof NOTIFICATION_REACTION_CREATED;
```

`apps/server/src/notifications/notification.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type {
  MarkNotificationsReadInput,
  NotificationDto,
  NotificationListResponse,
} from '@moment/dto';
import { BadRequestError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { notifications, pushTokens, type Notification } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { PushService } from '../push/push-service.js';
import { NOTIFICATION_REACTION_CREATED, type NotificationType } from './types.js';

/** 通知游标：base64url(JSON {t: <createdAt epochMs>, i: <notificationId>})，降序「严格早于」语义 */
function encodeCursor(t: number, i: string): string {
  return Buffer.from(JSON.stringify({ t, i }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { t: number; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestError('INVALID_CURSOR');
  }
  const p = parsed as { t?: unknown; i?: unknown };
  if (typeof p.t !== 'number' || !Number.isSafeInteger(p.t) || typeof p.i !== 'string' || p.i.length === 0) {
    throw new BadRequestError('INVALID_CURSOR');
  }
  return { t: p.t, i: p.i };
}

@Service()
export class NotificationService {
  /** 通知列表（仅本人，降序新→旧；unread=true 只看未读）。 */
  async list(
    userId: string,
    query: { unread?: string; cursor?: string; limit?: string }
  ): Promise<NotificationListResponse> {
    let limit = 20;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new BadRequestError('INVALID_LIMIT');
      }
    }

    const conditions: SQL[] = [eq(notifications.userId, userId)];
    if (query.unread === 'true') conditions.push(isNull(notifications.readAt));
    if (query.cursor !== undefined && query.cursor !== '') {
      const cur = decodeCursor(query.cursor);
      const before = new Date(cur.t);
      conditions.push(
        or(lt(notifications.createdAt, before), and(eq(notifications.createdAt, before), lt(notifications.id, cur.i))) as SQL,
      );
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      notifications: page.map((n) => this.toDto(n)),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt.getTime(), last.id) : null,
    };
  }

  /** 标已读：仅本人的行生效，混入他人 id 静默忽略（不报错、不泄露他人通知存在性）。 */
  async markRead(userId: string, input: MarkNotificationsReadInput): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, input.ids), isNull(notifications.readAt)));
  }

  /**
   * 扇出（仅 worker 调用，请求路径禁用——spec §5.4）：
   * 1) 批量插 notifications 行——幂等防御：已存在同去重键行的用户跳过插行（防 worker 崩溃租约重投导致重复通知）。
   *    去重键按类型区分（Global Constraints）：`reaction.created` = (userId, type, momentId, emoji)
   *    （换表情 = 新通知），其余 = (userId, type, momentId)；payload 无 momentId 时跳过去重直接插行
   *    （drizzle 的 json 列不可直接做 eq 条件，取出后应用层比对；type 为 varchar，
   *    已在 SQL 层 `eq(notifications.type, args.type)` 收窄，长链/老用户下不取回全量历史通知）；
   * 2) push=true 时对**全量** userIds（而非仅新插行用户）查有效 push_tokens 批量推送
   *    ——插行成功但 push 失败的整单重试时，补的是上轮漏掉的 push；
   * 3) send 返回的 invalidTokens 置 invalidated_at（spec §3 push_tokens）。
   */
  async fanoutNotifications(
    deps: { push: PushService },
    args: { userIds: string[]; type: NotificationType; payload: Record<string, unknown>; push: boolean }
  ): Promise<void> {
    if (args.userIds.length === 0) return;
    const momentId = typeof args.payload.momentId === 'string' ? args.payload.momentId : null;
    const emoji = typeof args.payload.emoji === 'string' ? args.payload.emoji : null;

    const existingRows = await db
      .select({ userId: notifications.userId, type: notifications.type, payload: notifications.payload })
      .from(notifications)
      .where(and(inArray(notifications.userId, args.userIds), eq(notifications.type, args.type)));
    // 无 momentId 的类型不做去重（避免与所有历史无 momentId 通知误判）
    const alreadyNotified =
      momentId === null
        ? new Set<string>()
        : new Set(
            existingRows
              .filter((r) => {
                const p = r.payload as { momentId?: unknown; emoji?: unknown };
                if (r.type !== args.type || p.momentId !== momentId) return false;
                // reaction.created 去重键含 emoji：换表情 = 新通知（Global Constraints）
                if (args.type === NOTIFICATION_REACTION_CREATED) return p.emoji === emoji;
                return true;
              })
              .map((r) => r.userId)
          );

    const insertTargets = args.userIds.filter((uid) => !alreadyNotified.has(uid));
    if (insertTargets.length > 0) {
      await db.insert(notifications).values(
        insertTargets.map((uid) => ({
          id: randomUUID(),
          userId: uid,
          type: args.type,
          payload: args.payload,
        }))
      );
    }

    if (!args.push) return;
    const tokenRows = await db
      .select()
      .from(pushTokens)
      .where(and(inArray(pushTokens.userId, args.userIds), isNull(pushTokens.invalidatedAt)));
    if (tokenRows.length === 0) return;

    const title = typeof args.payload.title === 'string' ? args.payload.title : '时刻';
    const body = typeof args.payload.body === 'string' ? args.payload.body : '你有新的动态';
    try {
      const outcome = await deps.push.send(
        tokenRows.map((t) => ({
          to: t.expoToken,
          title,
          body,
          data: { type: args.type, ...(args.payload.data as Record<string, unknown> | undefined) },
        }))
      );
      if (outcome.invalidTokens.length > 0) {
        await db
          .update(pushTokens)
          .set({ invalidatedAt: new Date() })
          .where(inArray(pushTokens.expoToken, outcome.invalidTokens));
      }
    } catch (err) {
      logger.error('push send failed; will retry via outbox', err);
      throw err;
    }
  }

  private toDto(n: Notification): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      payload: n.payload as Record<string, unknown>,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
```

`apps/server/src/notifications/notifications.controller.ts`：
```ts
import { markNotificationsReadSchema, type NotificationListResponse, type UserProfile } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Post,
  QueryParam,
} from 'routing-controllers';
import { Service } from 'typedi';
import { NotificationService } from './notification.service.js';

@JsonController('/notifications')
@Service()
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('/')
  @Authorized()
  list(
    @CurrentUser() user: UserProfile,
    @QueryParam('unread') unread: string | undefined,
    @QueryParam('cursor') cursor: string | undefined,
    @QueryParam('limit') limit: string | undefined
  ): Promise<NotificationListResponse> {
    return this.notificationService.list(user.id, { unread, cursor, limit });
  }

  @Post('/read')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  markRead(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<void> {
    return this.notificationService.markRead(user.id, markNotificationsReadSchema.parse(body));
  }
}
```

`apps/server/src/devices/devices.controller.ts`：
```ts
import { registerPushTokenSchema, type UserProfile } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { Authorized, Body, CurrentUser, HttpCode, JsonController, OnUndefined, Post } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { pushTokens } from '../db/schema.js';

@JsonController('/devices')
@Service()
export class DevicesController {
  /**
   * 注册/心跳：expo_token 全局唯一 upsert（同 token 换账号=重新绑定），每次刷新 last_seen_at。
   * 一条 INSERT ... ON DUPLICATE KEY UPDATE——先查后写在并发/双击重复注册时会撞唯一索引（500）。
   */
  @Post('/push-token')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  async register(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<void> {
    const input = registerPushTokenSchema.parse(body);
    await db
      .insert(pushTokens)
      .values({
        id: randomUUID(),
        userId: user.id,
        expoToken: input.expoToken,
        platform: input.platform,
        lastSeenAt: new Date(),
        invalidatedAt: null,
      })
      .onDuplicateKeyUpdate({
        set: { userId: user.id, platform: input.platform, lastSeenAt: new Date(), invalidatedAt: null },
      });
  }
}
```

`apps/server/src/app.ts` 修改点：import 区加：
```ts
import { NotificationsController } from './notifications/notifications.controller.js';
import { DevicesController } from './devices/devices.controller.js';
```
`controllers: [...]` 数组追加两项（保留既有项）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test`
Expected: notifications 4 + devices 4 个用例 PASS；既有全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): 通知列表/已读与设备 push-token 注册端点"
```

---

### Task 8: worker 处理器（moment/comment/reaction 扇出，TDD 函数级——直接调用 handler，不起 worker 进程）

**Files:**
- Create: `apps/server/src/worker/handlers.ts`
- Test: `apps/server/tests/worker/handlers.test.ts`

**Interfaces:**
- Consumes: `outbox` 表与既有事件 payload 契约（Phase 3 `moment.created` = `{momentId, chainId, authorId, isBackfill}`；Task 3 `comment.created` = `{commentId, momentId, chainId, authorId}`；Task 4 `reaction.created` = `{momentId, chainId, userId, emoji}`）、Task 6 `PushService`/`MockPushService`、Task 7 `NotificationService.fanoutNotifications`/`NOTIFICATION_*` 常量。
- Produces（Task 9 processor 依赖，不得改名）:
  - `type OutboxHandler = (payload: Record<string, unknown>, deps: { push: PushService }) => Promise<void>`
  - `handlers: Record<string, OutboxHandler>`（键 = outbox `type` 字符串；未知 type 由 processor 直接标 failed，不重试）
  - `handleMomentCreated` / `handleCommentCreated` / `handleReactionCreated`（导出，供函数级测试）
  - `handleMomentDeleted`：**no-op**（导出）。Phase 3 软删路径持续产生 `moment.deleted` outbox 行，若不注册，每次软删都会被 processor 标 failed、污染 spec §7 失败指标——故 Phase 5 即注册 no-op，Phase 8 替换为真正的媒体清理 sweeper。
  - 语义：
    - `moment.created` → 链全体成员（除作者）各插一条通知（payload 快照：`{ momentId, chainName, actorNickname, summary, backfill, title, body, data }`）；`is_backfill=true` → `fanout push=false` 且 payload 带 `backfill:true`，否则 push=true
    - `comment.created` → 仅 moment 作者（评论者本人时直接 return）；快照含评论摘要
    - `reaction.created` → 仅 moment 作者（点表情者本人时直接 return）；快照含 emoji
    - moment 已软删 → 静默返回（通知不补发，spec §3 优雅降级）

- [ ] **Step 1: 写失败测试**

`apps/server/tests/worker/handlers.test.ts`：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chainMembers, comments, notifications, pushTokens } from '../../src/db/schema.js';
import { MockPushService } from '../../src/push/mock.js';
import {
  handleCommentCreated,
  handleMomentCreated,
  handleMomentDeleted,
  handleReactionCreated,
  handlers,
} from '../../src/worker/handlers.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

/** 造一条链：owner（moment 作者）+ extra 个 viewer 成员。 */
async function setupChainMoment(extra: number, opts: { isBackfill?: boolean; deleted?: boolean } = {}) {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const members: string[] = [];
  for (let i = 0; i < extra; i++) {
    const u = await registerUser();
    await db.insert(chainMembers).values({ chainId, userId: u.id, role: 'viewer', joinedAt: new Date() });
    members.push(u.id);
  }
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date(),
    isBackfill: opts.isBackfill ?? false,
    deletedAt: opts.deleted ? new Date() : undefined,
  });
  return { owner, members, chainId, momentId };
}

describe('handleMomentCreated（链内新 moment，spec §5.4）', () => {
  it('扇出到链全体成员（除作者）：owner+2 成员 → 2 条通知 + push', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(2);
    const push = new MockPushService();

    await handleMomentCreated(
      { momentId, chainId, authorId: owner.id, isBackfill: false },
      { push }
    );

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId))).toEqual(new Set(members));
    expect(rows.every((r) => r.type === 'moment.created')).toBe(true);
    // 快照字段
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.momentId).toBe(momentId);
    expect(payload.chainName).toEqual(expect.any(String));
    expect(payload.actorNickname).toBeTruthy();
    expect(payload.backfill).toBe(false);
    // push 走到有效 token 的用户（无 token → 0 条消息，不报错）
    expect(push.sent).toHaveLength(0);
  });

  it('is_backfill=true：仍插通知（backfill:true）但跳过 push', async () => {
    const { owner, chainId, momentId } = await setupChainMoment(1, { isBackfill: true });
    const push = new MockPushService();

    await handleMomentCreated(
      { momentId, chainId, authorId: owner.id, isBackfill: true },
      { push }
    );

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { backfill: boolean }).backfill).toBe(true);
    expect(push.sent).toHaveLength(0);
  });

  it('moment 已软删 → 不扇出', async () => {
    const { owner, chainId, momentId } = await setupChainMoment(1, { deleted: true });
    const push = new MockPushService();
    await handleMomentCreated({ momentId, chainId, authorId: owner.id, isBackfill: false }, { push });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it('有 push_token 的成员收到推送；send 返回的失效 token 被置 invalidated_at', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(2);
    const token = 'ExponentPushToken[eeeeeeeeeeeeeeeeeeeeee]';
    await db.insert(pushTokens).values({
      id: 'tok-1',
      userId: members[0],
      expoToken: token,
      platform: 'ios',
      lastSeenAt: new Date(),
      invalidatedAt: null,
    });
    const push = new MockPushService();
    push.invalidTokensToReport = [token];

    await handleMomentCreated({ momentId, chainId, authorId: owner.id, isBackfill: false }, { push });

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0].to).toBe(token);
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.id, 'tok-1'));
    expect(row.invalidatedAt).not.toBeNull();
  });
});

describe('handleCommentCreated / handleReactionCreated', () => {
  it('评论 → 仅 moment 作者收到通知与推送；作者自己评论不通知', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(1);
    const push = new MockPushService();
    // handler 先查评论行（查不到/已软删直接 return），必须先插入真实行
    await db.insert(comments).values({ id: 'c-1', momentId, authorId: members[0], content: '好文' });
    await handleCommentCreated(
      { commentId: 'c-1', momentId, chainId, authorId: members[0] },
      { push }
    );
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(owner.id);
    expect(rows[0].type).toBe('comment.created');

    // 作者评论自己的 moment → 在 `m.authorId === authorId` 分支 return，不插行（同样先插行，语义真实）
    await db.insert(comments).values({ id: 'c-2', momentId, authorId: owner.id, content: '自评' });
    await handleCommentCreated({ commentId: 'c-2', momentId, chainId, authorId: owner.id }, { push });
    expect(await db.select().from(notifications)).toHaveLength(1);
    expect(push.sent).toHaveLength(0);
  });

  it('表情 → 仅 moment 作者；点自己 moment 不通知；payload 含 emoji', async () => {
    const { owner, members, chainId, momentId } = await setupChainMoment(1);
    const push = new MockPushService();
    await handleReactionCreated(
      { momentId, chainId, userId: members[0], emoji: '🎉' },
      { push }
    );
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect((rows[0].payload as { emoji: string }).emoji).toBe('🎉');

    await handleReactionCreated({ momentId, chainId, userId: owner.id, emoji: '👍' }, { push });
    expect(await db.select().from(notifications)).toHaveLength(1);

    // 换表情 = 新通知（去重键含 emoji，Global Constraints）
    await handleReactionCreated({ momentId, chainId, userId: members[0], emoji: '❤️' }, { push });
    expect(await db.select().from(notifications)).toHaveLength(2);
  });
});

describe('handlers 注册表', () => {
  it('四种事件均已注册（moment.deleted 为 no-op 占位）', () => {
    expect(handlers['moment.created']).toBe(handleMomentCreated);
    expect(handlers['comment.created']).toBe(handleCommentCreated);
    expect(handlers['reaction.created']).toBe(handleReactionCreated);
    expect(handlers['moment.deleted']).toBe(handleMomentDeleted);
    expect(Object.keys(handlers)).toHaveLength(4);
  });

  it('moment.deleted no-op：直接成功、不产生任何通知（Phase 8 替换为 sweeper）', async () => {
    await expect(
      handleMomentDeleted({ momentId: 'm-x', chainId: 'c-x' }, { push: new MockPushService() })
    ).resolves.toBeUndefined();
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- handlers`
Expected: FAIL（`Cannot find module '../../src/worker/handlers.js'`）

- [ ] **Step 3: 实现**

`apps/server/src/worker/handlers.ts`：
```ts
import { eq, inArray } from 'drizzle-orm';
import { Container } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, chains, comments, moments, users } from '../db/schema.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  NOTIFICATION_COMMENT_CREATED,
  NOTIFICATION_MOMENT_CREATED,
  NOTIFICATION_REACTION_CREATED,
} from '../notifications/types.js';
import type { PushService } from '../push/push-service.js';

export type OutboxHandler = (payload: Record<string, unknown>, deps: { push: PushService }) => Promise<void>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** moment 文本摘要（payload 快照用，spec §3：删除后通知仍可展示） */
function summarize(content: string, max = 50): string {
  return content.length > max ? `${content.slice(0, max)}…` : content;
}

/** 快照三件套：链名 + 行为人昵称 + 摘要（一次 IN 查询）。 */
async function loadSnapshot(chainId: string, actorIds: string[]): Promise<{
  chainName: string;
  nicknames: Map<string, string>;
}> {
  const [chain] = await db.select({ name: chains.name }).from(chains).where(eq(chains.id, chainId)).limit(1);
  const actorRows = actorIds.length
    ? await db
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  return { chainName: chain?.name ?? '', nicknames: new Map(actorRows.map((a) => [a.id, a.nickname])) };
}

function notificationService(): NotificationService {
  return Container.get(NotificationService);
}

/** moment.created：链全体成员（除作者）。is_backfill=true 跳过 push 但仍插通知（spec §5.6/§5.4）。 */
export const handleMomentCreated: OutboxHandler = async (payload, deps) => {
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const authorId = str(payload.authorId);
  const isBackfill = payload.isBackfill === true;

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return; // 已删：通知不补发

  const memberRows = await db
    .select({ userId: chainMembers.userId })
    .from(chainMembers)
    .where(eq(chainMembers.chainId, chainId));
  const targets = memberRows.map((r) => r.userId).filter((uid) => uid !== authorId);
  if (targets.length === 0) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [authorId]);
  const actorNickname = nicknames.get(authorId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: targets,
    type: NOTIFICATION_MOMENT_CREATED,
    payload: {
      momentId,
      chainId,
      chainName,
      actorNickname,
      summary: summarize(m.content),
      backfill: isBackfill,
      title: chainName || '时刻',
      body: `${actorNickname} 发布了新动态：${summarize(m.content, 30)}`,
      data: { momentId, chainId },
    },
    push: !isBackfill,
  });
};

/** comment.created：仅 moment 作者（评论者本人不通知，spec §5.4）。 */
export const handleCommentCreated: OutboxHandler = async (payload, deps) => {
  const commentId = str(payload.commentId);
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const authorId = str(payload.authorId);

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;
  if (m.authorId === authorId) return;

  const [c] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (!c || c.deletedAt) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [authorId]);
  const actorNickname = nicknames.get(authorId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: [m.authorId],
    type: NOTIFICATION_COMMENT_CREATED,
    payload: {
      momentId,
      chainId,
      commentId,
      chainName,
      actorNickname,
      summary: summarize(c.content),
      title: chainName || '时刻',
      body: `${actorNickname} 评论了你的时刻：${summarize(c.content, 30)}`,
      data: { momentId, chainId },
    },
    push: true,
  });
};

/** reaction.created：仅 moment 作者（本人不通知）。 */
export const handleReactionCreated: OutboxHandler = async (payload, deps) => {
  const momentId = str(payload.momentId);
  const chainId = str(payload.chainId);
  const userId = str(payload.userId);
  const emoji = str(payload.emoji);

  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;
  if (m.authorId === userId) return;

  const { chainName, nicknames } = await loadSnapshot(chainId, [userId]);
  const actorNickname = nicknames.get(userId) ?? '';
  await notificationService().fanoutNotifications(deps, {
    userIds: [m.authorId],
    type: NOTIFICATION_REACTION_CREATED,
    payload: {
      momentId,
      chainId,
      emoji,
      chainName,
      actorNickname,
      title: chainName || '时刻',
      body: `${actorNickname} 给你的时刻点了 ${emoji}`,
      data: { momentId, chainId },
    },
    push: true,
  });
};

/**
 * moment.deleted：Phase 5 为 no-op——Phase 3 软删路径持续产生该事件，不注册的话每次软删都会被
 * processor 标 failed、污染 spec §7 失败指标。Phase 8 替换为媒体清理 sweeper。
 */
export const handleMomentDeleted: OutboxHandler = async () => {};

/** 注册表：processor 按 outbox.type 分发。 */
export const handlers: Record<string, OutboxHandler> = {
  'moment.created': handleMomentCreated,
  'comment.created': handleCommentCreated,
  'reaction.created': handleReactionCreated,
  'moment.deleted': handleMomentDeleted,
};
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- handlers`
Expected: handlers 8 个用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): outbox 事件处理器（moment 扇出/评论/表情通知 + push）"
```

---

### Task 9: outbox processor（claim 租约 + 指数退避）+ worker 入口 + 全量验证（TDD）

**Files:**
- Modify: `apps/server/src/config.ts`（加 `WORKER_POLL_INTERVAL_MS`/`WORKER_BATCH_SIZE`）
- Modify: `apps/server/.env.example`
- Create: `apps/server/src/worker/processor.ts`、`apps/server/src/worker/index.ts`
- Test: `apps/server/tests/worker/processor.test.ts`

**Interfaces:**
- Consumes: `outbox` 表、Task 8 `handlers`/`OutboxHandler`、Task 6 `getPushService`、`logger`、`config`。
- Produces:
  - `config.WORKER_POLL_INTERVAL_MS: number`（默认 2000）、`config.WORKER_BATCH_SIZE: number`（默认 20）
  - `RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 14_400_000]`（1min/5min/15min/1h/4h）、`CLAIM_LEASE_MS = 60_000`
  - `runOutboxBatch(deps?: { push?: PushService; handlers?: Record<string, OutboxHandler>; batchSize?: number; now?: () => Date }): Promise<{ claimed: number; done: number; retried: number; failed: number }>`——claim（短事务 FOR UPDATE SKIP LOCKED + 租约）→ 逐条分发 → done/退避/failed
  - `apps/server/src/worker/index.ts` 独立进程入口（`pnpm --filter @moment/server worker`）：`while(running)` 轮询 + SIGINT/SIGTERM 优雅退出

- [ ] **Step 1: config + env 模板**

`apps/server/src/config.ts` 的 `envSchema` 中（`EXPO_ACCESS_TOKEN` 行之后）追加：
```ts
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
```
`apps/server/.env.example` 末尾追加：
```dotenv

# outbox worker（apps/server/src/worker/index.ts）
WORKER_POLL_INTERVAL_MS=2000
WORKER_BATCH_SIZE=20
```

- [ ] **Step 2: 写失败测试**

`apps/server/tests/worker/processor.test.ts`：
```ts
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { outbox } from '../../src/db/schema.js';
import { MockPushService } from '../../src/push/mock.js';
import type { PushService } from '../../src/push/push-service.js';
import type { OutboxHandler } from '../../src/worker/handlers.js';
import { CLAIM_LEASE_MS, RETRY_DELAYS_MS, runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

function emitRow(id: string, over: Partial<typeof outbox.$inferInsert> = {}): Promise<unknown> {
  return db.insert(outbox).values({ id, type: 'comment.created', payload: {}, status: 'pending', ...over });
}

const okPush: PushService = new MockPushService();

describe('runOutboxBatch', () => {
  it('成功处理：claim → handler 执行 → status=done + processed_at', async () => {
    await emitRow('ob-1');
    const handler = jest.fn().mockResolvedValue(undefined);

    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': handler as unknown as OutboxHandler } });
    expect(result).toEqual({ claimed: 1, done: 1, retried: 0, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-1'));
    expect(row.status).toBe('done');
    expect(row.processedAt).not.toBeNull();
    expect(row.attempts).toBe(0);
  });

  it('失败重试：attempts+1、next_retry_at = now + 1min（首档退避）', async () => {
    await emitRow('ob-2');
    const before = Date.now();
    const failing: OutboxHandler = async () => {
      throw new Error('EXPO_DOWN');
    };

    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result).toEqual({ claimed: 1, done: 0, retried: 1, failed: 0 });

    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-2'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt!.getTime() - before).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[0] - 1000);
    expect(row.nextRetryAt!.getTime() - before).toBeLessThanOrEqual(RETRY_DELAYS_MS[0] + 5000);
  });

  it('退避按 attempts 递增档位；attempts=5 仍按 4h 档重试，attempts>5 → failed', async () => {
    const failing: OutboxHandler = async () => {
      throw new Error('STILL_DOWN');
    };
    // 第 5 次失败：仍走重试，用最后一档 4h（4h 档可达）
    await emitRow('ob-3', { attempts: 4 });
    const fifth = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(fifth.retried).toBe(1);
    const [row5] = await db.select().from(outbox).where(eq(outbox.id, 'ob-3'));
    expect(row5.status).toBe('pending');
    expect(row5.attempts).toBe(5);

    // 第 6 次失败（5 档退避用尽）：failed
    await emitRow('ob-3b', { attempts: 5 });
    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': failing } });
    expect(result.failed).toBe(1);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-3b'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.nextRetryAt).toBeNull();
  });

  it('未到期的行不 claim（租约生效）：claim 后立即再跑不重复处理', async () => {
    await emitRow('ob-4');
    const handler = jest.fn().mockResolvedValue(undefined);
    const deps = { push: okPush, handlers: { 'comment.created': handler as unknown as OutboxHandler } };

    await runOutboxBatch(deps);
    const second = await runOutboxBatch(deps);
    // 第一次已 done；done 行本就不参与。改用「租约挡 pending」的场景：
    expect(second.claimed).toBe(0);

    await emitRow('ob-5');
    const slowFail: OutboxHandler = async () => {
      throw new Error('RETRY_LATER');
    };
    await runOutboxBatch({ ...deps, handlers: { 'comment.created': slowFail } });
    // 失败后 next_retry_at 在未来（1min 档），下一批不再 claim
    const third = await runOutboxBatch({ ...deps, handlers: { 'comment.created': slowFail } });
    expect(third.claimed).toBe(0);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-5'));
    expect(row.attempts).toBe(1);
  });

  it('未注册的 type → 直接 failed（不无限重试）', async () => {
    await emitRow('ob-6', { type: 'future.sweep' });
    const result = await runOutboxBatch({ push: okPush, handlers: {} });
    expect(result.failed).toBe(1);
    const [row] = await db.select().from(outbox).where(eq(outbox.id, 'ob-6'));
    expect(row.status).toBe('failed');
  });

  it('claim 时先把选中行 next_retry_at 推到 now+60s（崩溃保护租约），再执行 handler', async () => {
    await emitRow('ob-7');
    const before = Date.now();
    let seenNextRetryAt: number | null = null;
    const slowHandler: OutboxHandler = async () => {
      // handler 执行中回读：租约必须已写入（claim 事务已提交）
      const [mid] = await db.select().from(outbox).where(eq(outbox.id, 'ob-7'));
      seenNextRetryAt = mid.nextRetryAt?.getTime() ?? null;
      throw new Error('CRASH_SIMULATED');
    };

    const result = await runOutboxBatch({ push: okPush, handlers: { 'comment.created': slowHandler } });
    expect(result.retried).toBe(1);
    expect(seenNextRetryAt).not.toBeNull();
    expect(seenNextRetryAt!).toBeGreaterThanOrEqual(before + CLAIM_LEASE_MS - 1000);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/server test -- processor`
Expected: FAIL（`Cannot find module '../../src/worker/processor.js'`）

- [ ] **Step 4: 实现 processor.ts**

`apps/server/src/worker/processor.ts`：
```ts
import { and, asc, eq, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { outbox } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import type { PushService } from '../push/push-service.js';
import { getPushService } from '../push/factory.js';
import { handlers as defaultHandlers, type OutboxHandler } from './handlers.js';

/** 指数退避档位（spec §5.4）：1min → 5min → 15min → 1h → 4h */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 4 * 3_600_000] as const;
/** claim 租约：处理期间（含慢 IO 的 push）其他批次/进程不取同一行；崩溃后 60s 自动重投。 */
export const CLAIM_LEASE_MS = 60_000;

export interface OutboxBatchResult {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
}

export interface ProcessorDeps {
  push?: PushService;
  handlers?: Record<string, OutboxHandler>;
  batchSize?: number;
  now?: () => Date;
}

/**
 * 一批 outbox 消费（spec §5.4）：
 * 1) claim：短事务内 SELECT ... FOR UPDATE SKIP LOCKED 取到期 pending 行，写 60s 租约后提交
 *    ——处理（含 Expo Push 慢 IO）在锁外进行，不长期持锁；多 worker 并发下同一行只被一个批次持有。
 * 2) 逐条分发 handler；成功 → done；失败 → attempts+1 + 档位退避；attempts>5（5 档退避全部用尽）→ failed。
 * 3) 未注册 type → 直接 failed（不重试无效循环；已注册类型含 moment.deleted 的 no-op 占位，见 handlers.ts）。
 */
export async function runOutboxBatch(deps: ProcessorDeps = {}): Promise<OutboxBatchResult> {
  const push = deps.push ?? getPushService();
  const table = deps.handlers ?? defaultHandlers;
  const batchSize = deps.batchSize ?? config.WORKER_BATCH_SIZE;
  const now = deps.now ?? (() => new Date());

  const claimedIds = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.status, 'pending'),
          or(isNull(outbox.nextRetryAt), lte(outbox.nextRetryAt, now())) as SQL,
        )
      )
      .orderBy(asc(outbox.createdAt))
      .limit(batchSize)
      .for('update', { skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(outbox)
      .set({ nextRetryAt: new Date(now().getTime() + CLAIM_LEASE_MS) })
      .where(inArray(outbox.id, rows.map((r) => r.id)));
    return rows.map((r) => r.id);
  });

  const result: OutboxBatchResult = { claimed: claimedIds.length, done: 0, retried: 0, failed: 0 };
  if (claimedIds.length === 0) return result;

  const rows = await db.select().from(outbox).where(inArray(outbox.id, claimedIds));
  for (const row of rows) {
    const handler = table[row.type];
    if (!handler) {
      logger.warn('no handler for outbox type; marking failed', { id: row.id, type: row.type });
      await db
        .update(outbox)
        .set({ status: 'failed', processedAt: now(), nextRetryAt: null })
        .where(eq(outbox.id, row.id));
      result.failed += 1;
      continue;
    }
    try {
      await handler(row.payload as Record<string, unknown>, { push });
      await db
        .update(outbox)
        .set({ status: 'done', processedAt: now(), nextRetryAt: null })
        .where(eq(outbox.id, row.id));
      result.done += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      // attempts=5 时仍按 4h 档（RETRY_DELAYS_MS[4]）排重试；>5（5 档用尽）才 failed
      if (attempts > RETRY_DELAYS_MS.length) {
        logger.error('outbox entry exhausted retries', { id: row.id, type: row.type, attempts, err });
        await db
          .update(outbox)
          .set({ status: 'failed', attempts, processedAt: now(), nextRetryAt: null })
          .where(eq(outbox.id, row.id));
        result.failed += 1;
      } else {
        logger.warn('outbox entry failed; will retry', { id: row.id, type: row.type, attempts, err });
        await db
          .update(outbox)
          .set({ attempts, nextRetryAt: new Date(now().getTime() + RETRY_DELAYS_MS[attempts - 1]) })
          .where(eq(outbox.id, row.id));
        result.retried += 1;
      }
    }
  }
  return result;
}
```

- [ ] **Step 5: 实现 worker 入口 index.ts**

`apps/server/src/worker/index.ts`：
```ts
import 'reflect-metadata';
import { config } from '../config.js';
import { pool } from '../db/index.js';
import { getPushService } from '../push/factory.js';
import { logger } from '../utils/logger.js';
import { runOutboxBatch } from './processor.js';

/** 独立 worker 进程（spec §5.4）：与 API 同 codebase、不同进程；docker-compose service 属 Phase 8。 */

let running = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  logger.info('worker started', {
    pollMs: config.WORKER_POLL_INTERVAL_MS,
    batchSize: config.WORKER_BATCH_SIZE,
  });
  while (running) {
    try {
      const result = await runOutboxBatch({ push: getPushService() });
      if (result.claimed > 0) {
        logger.info('outbox batch processed', result);
      }
    } catch (err) {
      // 单批意外崩溃不退出进程（spec §7：记录积压/失败指标）
      logger.error('outbox batch crashed', err);
    }
    await sleep(config.WORKER_POLL_INTERVAL_MS);
  }
  await pool.end();
  logger.info('worker stopped');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`worker received ${sig}, draining...`);
    running = false;
  });
}

void main();
```

- [ ] **Step 6: 运行确认通过 + worker 手动冒烟**

Run: `pnpm --filter @moment/server test`
Expected: processor 6 个用例 PASS；Phase 1–5 全部既有测试 PASS。

手动冒烟（dev，验证进程可起停，不验证真实 Expo）：
```bash
pnpm --filter @moment/server worker &
WORKER_PID=$!
sleep 3
# 起后 kill，观察日志有 "worker started" 与优雅退出（记录 PID 再 kill：非交互 shell 无 job control，kill %1 不可用）
kill $WORKER_PID
```
Expected: 日志输出 `worker started`；kill 后输出 `worker stopped` 进程退出。

- [ ] **Step 7: 全量验证**

Run: `pnpm install && pnpm build && pnpm lint && pnpm test`
Expected: build 成功、lint 无 error、全部测试 PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): outbox processor（SKIP LOCKED 租约+指数退避）与 worker 独立入口"
```

---

## 完成标准（Phase 5 DoD）

- `pnpm build && pnpm lint && pnpm test` 全绿。
- 手动 curl 验证（dev）：注册 A/B/C → A 建链加 B(viewer)/C(viewer) → A（owner）发 moment（viewer 无权发，403）→ B/C（viewer）评论、点表情 → `pnpm --filter @moment/server worker` 跑起来后：A 的 `GET /api/notifications` 出现 comment.created 与 reaction.created；B、C 各自收到 moment.created；`POST /api/notifications/read` 置已读；backfill moment 只进列表不推送。
- `comments`/`reactions`/`notifications`/`push_tokens` 表存在且 `resetDb()` 覆盖；`outbox` 消费后 `status='done'`、`processed_at` 非空；构造 handler 失败可观察 `attempts` 递增、第 5 次失败仍排 4h 档重试、5 档退避用尽（`attempts>5`）后 `failed`。
- feed/链内列表/详情的 moment 响应均含 `commentCount`/`reactions`/`myReaction`（本人视角正确）；批量计数每页各一次 GROUP BY，无 N+1。
- `config.ts` 与 `.env.example` 含 `EXPO_ACCESS_TOKEN`/`WORKER_POLL_INTERVAL_MS`/`WORKER_BATCH_SIZE`；`package.json` 含 `"worker": "tsx watch src/worker/index.ts"`。
- 评论/表情端点权限语义全通：非成员一律 404 `CHAIN_NOT_FOUND`；viewer 可评论可点赞；moment 软删后 410。

## 留给后续 Phase 的接缝（不在本计划实现）

- Phase 6（App）：`POST /api/devices/push-token` 注册 Expo token；通知跳转按 payload.data.momentId 请求 `GET /api/moments/:id`，410 时优雅降级（spec §3）。
- Phase 8：`moment.deleted` 的真正处理（媒体清理 sweeper）——Phase 5 已注册 no-op handler（`handleMomentDeleted`）防止软删事件被标 failed，届时整体替换实现即可；worker 的 docker-compose service 化与备份 sidecar；链免打扰（notifications.type 维度已可扩展）。

