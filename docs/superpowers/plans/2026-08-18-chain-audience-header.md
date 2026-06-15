# 链页眉成员与可见性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ChainDto` 带上成员预览与人数；Web 链页标题右侧画出成员头像、角色浮层，以及 `link`/`public` 可见性标识。

**Architecture:** 不新开路由。`ChainService` 在序列化所有 `ChainDto` 之前按本次 `chainId` 一次查成员、一次签头像，挂上 `membersPreview`（最多 5，`joinedAt` 升序再 `userId` 升序）和 `memberCount`。Web 链页只读 `getChain` 已有字段，不打 `listMembers`。设置里改角色 / 移除 / 转让补发 `chain:changed`，链页现有听众会重拉。

**Tech Stack:** `@moment/dto` interface、Express + TypeDI + Drizzle + MySQL（真实测试库，Jest `--runInBand`）、Vite + React + Tailwind + `@rabjs/react`、Lucide via `Icon`。

**Spec:** `docs/superpowers/specs/2026-08-18-chain-audience-header-design.md`（含评审 6 条）。冲突以 spec 为准。

## Global Constraints

- 只增 `ChainMemberPreview` + `ChainDto.membersPreview` / `memberCount`，不改旧字段名或旧语义，不新增路由。
- `membersPreview.length === min(5, memberCount)`；排序 `joinedAt` 升序，并列 `userId` 升序；含自己；不含待接受邀请；JSON 无 `email` / `joinedAt`。
- `listMine` 一次成员查询 + 一次 `avatarUrlsByUserIds`（预览 userId 并集）。禁止按链循环或 `Promise.all(rows.map(attachPreview))`。`chainIds.length === 0` 时跳过查询，禁止 `IN ()`。
- `visibility`：`private` 不画标识，`link` = Lucide `Link` +「链接可看」，`public` = Lucide `Globe` +「公开」。生成/吊销分享链接不得改 `visibility`。
- Web 头像贴在链名右侧（不是最右）；24px、重叠 `--space-2`、1px `--bg` 描边；`+N` 的 `N = memberCount - membersPreview.length`。
- 头像不进设置。浮层：昵称 + `roleLabel`（创建者 / 可记录 / 只看）；`+N` 为「还有 N 人」。
- App 本轮不画此 UI，也不补与 Web 相同的新 emit。
- server 测试打 `.env` 测试库，`--runInBand`，`resetDb` + `afterAll(closeDb)`。Web 无组件测试 runner：typecheck + lint + 手验。
- 每 Task 一个 commit：`feat(dto):` / `feat(server):` / `feat(web):`。Node ESM，相对 import 带 `.js`。
- 尺度只准 token：禁止 `px-[18px]` / `h-[52px]` / `-mx-3.5`。控件走 `Button`/`Icon`/`Avatar`。

## 文件结构

| 路径 | 职责 |
|---|---|
| `packages/dto/src/chains.ts` | `ChainMemberPreview`；`ChainDto` 两新字段 |
| `apps/server/src/chains/chain.service.ts` | `attachPreviews` 批量组装；`toChainDto` 接收预览 |
| `apps/server/tests/chains/chains.crud.test.ts` | 创建 / 详情 / 列表隔离 / 切 5 人 / 邀请 / PATCH 预览 |
| `apps/server/tests/chains/chains.members.test.ts` | 转让响应里的预览角色 |
| `apps/web/src/ui/HoverTip.tsx` | 无业务 hover/点按浮层 |
| `apps/web/src/pages/chain-home/chain-audience.tsx` | 头像簇 + `+N` + 可见性标识 |
| `apps/web/src/pages/chain-home/index.tsx` | 标题行接入 `ChainAudience` |
| `apps/web/src/pages/chain-settings/chain-settings.service.ts` | 改角色 / 移除 / 转让 emit `chain:changed` |

不改：`PublicShareChainInfo`、分享链接写入、侧栏、`listMembers` 契约、App UI。

## 任务总览

| Task | 交付 |
|---|---|
| 1 | dto 类型导出，dto 测试绿 |
| 2 | 五个 `ChainDto` 出口带预览；server 预览用例绿 |
| 3 | 链页眉头像簇 + 浮层 + 可见性标识 |
| 4 | 设置改角色/移除/转让发 `chain:changed` |

---

### Task 1: dto — `ChainMemberPreview` 与 `ChainDto` 预览字段

**Files:**
- Modify: `packages/dto/src/chains.ts`（`ChainDto` 接口后、`ChainMemberDto` 前插入 `ChainMemberPreview`；给 `ChainDto` 加两字段）
- Modify: `packages/dto/src/chains.test.ts`（文末追加类型形状测试）
- Test: `packages/dto/src/chains.test.ts`

**Interfaces:**
- Consumes: 已有 `ChainRole`、`ChainDto` 旧字段。
- Produces:

```ts
export interface ChainMemberPreview {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: ChainRole;
}

export interface ChainDto {
  // 既有字段不变
  membersPreview: ChainMemberPreview[];
  memberCount: number;
}
```

`packages/dto/src/index.ts` 已 `export * from './chains.js'`，不用改。

- [ ] **Step 1: 写失败测试**

在 `packages/dto/src/chains.test.ts` 末尾追加（现有 import 增加 `ChainDto`、`ChainMemberPreview`）：

```ts
test('ChainMemberPreview 只有四字段；ChainDto 要求 membersPreview + memberCount', () => {
  const preview: ChainMemberPreview = {
    userId: 'u1',
    nickname: '妈',
    avatarUrl: null,
    role: 'owner',
  };
  assert.deepEqual(Object.keys(preview).sort(), ['avatarUrl', 'nickname', 'role', 'userId']);
  const slice: Pick<ChainDto, 'membersPreview' | 'memberCount'> = {
    membersPreview: [preview],
    memberCount: 1,
  };
  assert.equal(slice.memberCount, 1);
  assert.equal(slice.membersPreview[0].role, 'owner');
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `pnpm --filter @moment/dto test`

Expected: FAIL。`tsx` 报 `ChainMemberPreview`（或 `membersPreview`）无法从 `./chains.js` 导入。

- [ ] **Step 3: 最小实现**

`packages/dto/src/chains.ts` 在 `ChainDto` 内、`updatedAt` 之后追加：

```ts
  /** 成员预览：joinedAt 升序再 userId 升序，最多 5 人，含自己 */
  membersPreview: ChainMemberPreview[];
  /** 成员总数，含自己 */
  memberCount: number;
```

在 `ChainDto` 与 `ChainMemberDto` 之间插入：

```ts
export interface ChainMemberPreview {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: ChainRole;
}
```

不要给 `ChainMemberPreview` 加 `email` / `joinedAt`。不要改 `createChainInputSchema`。

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm --filter @moment/dto test`

Expected: PASS（含新建用例）。

然后构建，让 server/web/app 读到新类型：

Run: `pnpm --filter @moment/dto build`

Expected: `dist` 更新，无 tsc 错误。

- [ ] **Step 5: Commit**

```bash
git add packages/dto/src/chains.ts packages/dto/src/chains.test.ts
git commit -m "feat(dto): ChainDto 增加成员预览字段"
```

---

### Task 2: server — 批量挂上 `membersPreview` / `memberCount`

**Files:**
- Modify: `apps/server/src/chains/chain.service.ts`
- Modify: `apps/server/tests/chains/chains.crud.test.ts`
- Modify: `apps/server/tests/chains/chains.members.test.ts`
- Test: 上述两个测试文件

**Interfaces:**
- Consumes: Task 1 的 `ChainMemberPreview` / `ChainDto`；已有 `avatarUrlsByUserIds(userIds: string[]): Promise<Map<string, string | null>>`；`chainMembers`、`users`、`inArray`。
- Produces:

```ts
// chain.service.ts（私有，名称与签名必须一致，后续不要另起 attachPreview 单链版）
private async attachPreviews(
  items: { chain: Chain; role?: ChainRole }[],
): Promise<ChainDto[]>

private toChainDto(
  chain: Chain,
  myRole: ChainRole | undefined,
  extras: { membersPreview: ChainMemberPreview[]; memberCount: number },
): ChainDto
```

`create` / `update` / `transfer` 仍走 `getById`，不要各写一份组装。`listMine` 必须 `return this.attachPreviews(...)`，禁止 `Promise.all(rows.map(...))`。

- [ ] **Step 1: 写失败测试**

`apps/server/tests/chains/chains.crud.test.ts`：把 import 扩成：

```ts
import type { ChainDto } from '@moment/dto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { chainInvites, chainMembers } from '../../src/db/schema.js';
import { auth, createUser, type TestUser } from '../helpers/auth.js';
import { addMember, createChain } from '../helpers/chains.js';
import { closeDb, resetDb } from '../helpers/db.js';
```

在文件**最底部**（`DELETE` describe 之后）追加下面整段，不要改已有用例的断言逻辑。

```ts
function expectPreviewItem(
  actual: unknown,
  expected: { userId: string; nickname: string; role: 'owner' | 'editor' | 'viewer' },
): void {
  expect(actual).toEqual({
    userId: expected.userId,
    nickname: expected.nickname,
    avatarUrl: null,
    role: expected.role,
  });
  expect(actual as object).not.toHaveProperty('email');
  expect(actual as object).not.toHaveProperty('joinedAt');
}

async function setJoinedAt(chainId: string, userId: string, at: Date): Promise<void> {
  await db
    .update(chainMembers)
    .set({ joinedAt: at })
    .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, userId)));
}

describe('ChainDto membersPreview', () => {
  it('POST /chains：预览只有创建者，memberCount === 1', async () => {
    const res = await request(app)
      .post('/api/chains')
      .set('Authorization', auth(owner))
      .send({ name: '预览链' });
    expect(res.status).toBe(201);
    const chain = res.body as ChainDto;
    expect(chain.memberCount).toBe(1);
    expect(chain.membersPreview).toHaveLength(1);
    expectPreviewItem(chain.membersPreview[0], {
      userId: owner.id,
      nickname: 'owner',
      role: 'owner',
    });
  });

  it('GET /chains/:id 三人按 joinedAt 升序；GET /chains 两条链互不串', async () => {
    const chainA = await createChain(app, owner, 'A链');
    const editor = await createUser(app, 'editor@example.com');
    const viewer = await createUser(app, 'viewer@example.com');
    await addMember(chainA.id, editor.id, 'editor');
    await addMember(chainA.id, viewer.id, 'viewer');
    const t0 = new Date('2026-01-01T00:00:00Z');
    await setJoinedAt(chainA.id, owner.id, t0);
    await setJoinedAt(chainA.id, editor.id, new Date(t0.getTime() + 1000));
    await setJoinedAt(chainA.id, viewer.id, new Date(t0.getTime() + 2000));

    const chainSolo = await createChain(app, owner, 'C链');

    const one = await request(app).get(`/api/chains/${chainA.id}`).set('Authorization', auth(owner));
    expect(one.status).toBe(200);
    const detail = one.body as ChainDto;
    expect(detail.memberCount).toBe(3);
    expect(detail.membersPreview.map((m) => m.userId)).toEqual([owner.id, editor.id, viewer.id]);
    expectPreviewItem(detail.membersPreview[0], { userId: owner.id, nickname: 'owner', role: 'owner' });
    expectPreviewItem(detail.membersPreview[1], { userId: editor.id, nickname: 'editor', role: 'editor' });
    expectPreviewItem(detail.membersPreview[2], { userId: viewer.id, nickname: 'viewer', role: 'viewer' });

    const list = await request(app).get('/api/chains').set('Authorization', auth(owner));
    expect(list.status).toBe(200);
    const byId = Object.fromEntries((list.body as ChainDto[]).map((c) => [c.id, c]));
    expect(byId[chainA.id].memberCount).toBe(3);
    expect(byId[chainA.id].membersPreview.map((m) => m.userId)).toEqual([owner.id, editor.id, viewer.id]);
    expect(byId[chainSolo.id].memberCount).toBe(1);
    expect(byId[chainSolo.id].membersPreview).toHaveLength(1);
    expectPreviewItem(byId[chainSolo.id].membersPreview[0], {
      userId: owner.id,
      nickname: 'owner',
      role: 'owner',
    });
  });

  it('第 6 人加入后预览切 5 人，挤掉 joinedAt 最晚者', async () => {
    const chain = await createChain(app, owner, '六人链');
    const extras: TestUser[] = [];
    for (let i = 2; i <= 6; i++) {
      extras.push(await createUser(app, `u${i}@example.com`));
      await addMember(chain.id, extras[i - 2].id, 'viewer');
    }
    const t0 = new Date('2026-02-01T00:00:00Z');
    await setJoinedAt(chain.id, owner.id, t0);
    for (let i = 0; i < extras.length; i++) {
      await setJoinedAt(chain.id, extras[i].id, new Date(t0.getTime() + (i + 1) * 1000));
    }
    const excluded = extras[4]; // u6，最晚

    const res = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const body = res.body as ChainDto;
    expect(body.memberCount).toBe(6);
    expect(body.membersPreview).toHaveLength(5);
    expect(body.membersPreview.map((m) => m.userId)).toEqual([
      owner.id,
      extras[0].id,
      extras[1].id,
      extras[2].id,
      extras[3].id,
    ]);
    expect(body.membersPreview.map((m) => m.userId)).not.toContain(excluded.id);
    expectPreviewItem(body.membersPreview[0], { userId: owner.id, nickname: 'owner', role: 'owner' });
    expectPreviewItem(body.membersPreview[4], { userId: extras[3].id, nickname: 'u5', role: 'viewer' });
  });

  it('仅发出邀请未接受：预览仍只有创建者，响应无邀请邮箱', async () => {
    const chain = await createChain(app, owner, '邀请链');
    const inv = await request(app)
      .post(`/api/chains/${chain.id}/invites`)
      .set('Authorization', auth(owner))
      .send({ email: 'pending@example.com', role: 'editor' });
    expect(inv.status).toBe(201);

    const res = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    expect(res.status).toBe(200);
    const body = res.body as ChainDto;
    expect(body.memberCount).toBe(1);
    expect(body.membersPreview).toHaveLength(1);
    expectPreviewItem(body.membersPreview[0], { userId: owner.id, nickname: 'owner', role: 'owner' });
    expect(JSON.stringify(res.body)).not.toContain('pending@example.com');
  });

  it('PATCH visibility 不改预览 userId 与 memberCount', async () => {
    const chain = await createChain(app, owner, '可见性链');
    const editor = await createUser(app, 'ed2@example.com');
    await addMember(chain.id, editor.id, 'editor');
    const before = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(owner));
    const prev = before.body as ChainDto;

    const res = await request(app)
      .patch(`/api/chains/${chain.id}`)
      .set('Authorization', auth(owner))
      .send({ visibility: 'link' });
    expect(res.status).toBe(200);
    const after = res.body as ChainDto;
    expect(after.visibility).toBe('link');
    expect(after.memberCount).toBe(prev.memberCount);
    expect(after.membersPreview.map((m) => m.userId)).toEqual(prev.membersPreview.map((m) => m.userId));
  });

  it('非成员 GET 404 不带 membersPreview；未登录 401；无链列表为 []', async () => {
    const chain = await createChain(app, owner, '私链');
    const nf = await request(app).get(`/api/chains/${chain.id}`).set('Authorization', auth(outsider));
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('CHAIN_NOT_FOUND');
    expect(nf.body).not.toHaveProperty('membersPreview');

    expect((await request(app).get(`/api/chains/${chain.id}`)).status).toBe(401);

    const emptyUser = await createUser(app, 'nochains@example.com');
    const empty = await request(app).get('/api/chains').set('Authorization', auth(emptyUser));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);
  });
});
```

`apps/server/tests/chains/chains.members.test.ts`：在 `POST /api/chains/:chainId/transfer` 的第一个 `it`（owner 转让）**末尾、该 `it` 闭合前**追加：

```ts
    const preview = res.body as ChainDto;
    expect(preview.memberCount).toBe(3);
    const byUser = Object.fromEntries(preview.membersPreview.map((m) => [m.userId, m]));
    expect(byUser[editor.id].role).toBe('owner');
    expect(byUser[owner.id].role).toBe('editor');
    expect(new Set(preview.membersPreview.map((m) => m.userId))).toEqual(
      new Set([owner.id, editor.id, viewer.id]),
    );
    expect(byUser[editor.id]).not.toHaveProperty('email');
    expect(byUser[editor.id]).not.toHaveProperty('joinedAt');
```

该文件已 import `ChainDto`。`setup()` 里已有 owner/editor/viewer 三人。

- [ ] **Step 2: 跑测试，确认失败**

Run:

```bash
pnpm --filter @moment/server test -- tests/chains/chains.crud.test.ts tests/chains/chains.members.test.ts
```

Expected: FAIL。`toChainDto` 缺 `membersPreview`/`memberCount` 会编不过；若先临时补 `membersPreview: []`、`memberCount: 0` 让它编过，则 `memberCount === 1` 等断言失败。

若编不过挡住红灯：允许在 `toChainDto` 先写空预览，再跑同一条命令，确认断言红，不要在这一步写批量查询。

- [ ] **Step 3: 最小实现**

`apps/server/src/chains/chain.service.ts`：

1. import 增加 `type ChainMemberPreview`。
2. 删除旧的同步 `toChainDto(chain, myRole?)`。换成下面两个私有方法（不要按链再调 `avatarUrlsByUserIds`）：

```ts
  private toChainDto(
    chain: Chain,
    myRole: ChainRole | undefined,
    extras: { membersPreview: ChainMemberPreview[]; memberCount: number },
  ): ChainDto {
    return {
      id: chain.id,
      name: chain.name,
      description: chain.description,
      coverMediaId: chain.coverMediaId,
      color: isChainColor(chain.color) ? chain.color : null,
      icon: isChainIcon(chain.icon) ? chain.icon : null,
      visibility: chain.visibility,
      ownerId: chain.ownerId,
      ...(myRole ? { myRole } : {}),
      createdAt: chain.createdAt.toISOString(),
      updatedAt: chain.updatedAt.toISOString(),
      membersPreview: extras.membersPreview,
      memberCount: extras.memberCount,
    };
  }

  private async attachPreviews(items: { chain: Chain; role?: ChainRole }[]): Promise<ChainDto[]> {
    if (items.length === 0) return [];
    const chainIds = items.map((i) => i.chain.id);
    const rows = await db
      .select({
        chainId: chainMembers.chainId,
        userId: chainMembers.userId,
        role: chainMembers.role,
        joinedAt: chainMembers.joinedAt,
        nickname: users.nickname,
      })
      .from(chainMembers)
      .innerJoin(users, eq(chainMembers.userId, users.id))
      .where(inArray(chainMembers.chainId, chainIds));

    const byChain = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byChain.get(row.chainId) ?? [];
      list.push(row);
      byChain.set(row.chainId, list);
    }

    const previewUserIds: string[] = [];
    const prepared = new Map<string, { preview: typeof rows; count: number }>();
    for (const id of chainIds) {
      const list = [...(byChain.get(id) ?? [])].sort((a, b) => {
        const dt = a.joinedAt.getTime() - b.joinedAt.getTime();
        if (dt !== 0) return dt;
        if (a.userId < b.userId) return -1;
        if (a.userId > b.userId) return 1;
        return 0;
      });
      const preview = list.slice(0, 5);
      prepared.set(id, { preview, count: list.length });
      for (const p of preview) previewUserIds.push(p.userId);
    }

    const avatarBy = await avatarUrlsByUserIds(previewUserIds);
    return items.map(({ chain, role }) => {
      const extra = prepared.get(chain.id) ?? { preview: [], count: 0 };
      return this.toChainDto(chain, role, {
        memberCount: extra.count,
        membersPreview: extra.preview.map((p) => ({
          userId: p.userId,
          nickname: p.nickname,
          avatarUrl: avatarBy.get(p.userId) ?? null,
          role: p.role,
        })),
      });
    });
  }
```

3. 改调用点（只改这三处，`create`/`update`/`transfer` 继续 `return this.getById(...)`）：

```ts
  async listMine(userId: string): Promise<ChainDto[]> {
    const rows = await db
      .select({ chain: chains, role: chainMembers.role })
      .from(chainMembers)
      .innerJoin(chains, eq(chainMembers.chainId, chains.id))
      .where(eq(chainMembers.userId, userId))
      .orderBy(desc(chains.createdAt));
    return this.attachPreviews(rows.map((r) => ({ chain: r.chain, role: r.role })));
  }

  async getById(userId: string, chainId: string): Promise<ChainDto> {
    const role = await this.policy.require(userId, chainId, 'viewer');
    const [chain] = await db.select().from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND');
    const [dto] = await this.attachPreviews([{ chain, role }]);
    return dto;
  }
```

不要改 `createShareLink` / `ShareLinkService`。不要改 `listMembers` 的返回形状。

- [ ] **Step 4: 跑测试，确认通过**

Run:

```bash
pnpm --filter @moment/server test -- tests/chains/chains.crud.test.ts tests/chains/chains.members.test.ts
```

Expected: PASS（新旧用例全绿）。

再跑（防 dto 必填字段把下游编挂）：

```bash
pnpm --filter @moment/api-client test
pnpm --filter @moment/app typecheck
```

Expected: 都通过。App 没有手写 `ChainDto` 字面量；若 typecheck 红，只补缺字段，不要画 App UI。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/chains/chain.service.ts \
  apps/server/tests/chains/chains.crud.test.ts \
  apps/server/tests/chains/chains.members.test.ts
git commit -m "feat(server): 链响应附带 membersPreview"
```

---

### Task 3: web — 链页眉头像簇、浮层、可见性标识

**Files:**
- Create: `apps/web/src/ui/HoverTip.tsx`
- Create: `apps/web/src/pages/chain-home/chain-audience.tsx`
- Modify: `apps/web/src/pages/chain-home/index.tsx`（标题行：链名右侧插入 `ChainAudience`，简介仍在链名下）
- Test: 无组件测试。验证 = typecheck + lint。

**Interfaces:**
- Consumes: Task 1/2 的 `ChainDto.membersPreview` / `memberCount` / `visibility`；`Avatar`（`apps/web/src/ui/Avatar.tsx`）；`Icon`；`roleLabel(role)`（`apps/web/src/lib/roles.ts`）；`ChainHomeService.chain`（已有，不新建 Service，不调用 `listMembers`）。
- Produces:

```ts
// apps/web/src/ui/HoverTip.tsx
export function HoverTip(props: { label: ReactNode; children: ReactNode }): JSX.Element

// apps/web/src/pages/chain-home/chain-audience.tsx
export function ChainAudience(props: { chain: ChainDto }): JSX.Element
```

`HoverTip`：桌面 hover 开、离开关；触控点按切换；点空白关闭。无业务字段。
`ChainAudience`：渲染全部 `membersPreview`；`extra = chain.memberCount - chain.membersPreview.length`，`extra > 0` 时画 `+{extra}`；`private` 不画标识。

- [ ] **Step 1: 写 HoverTip**

创建 `apps/web/src/ui/HoverTip.tsx`（完整文件，不要再包一层业务）：

```tsx
import { useEffect, useState, type ReactNode } from 'react';

/** 无业务浮层：hover 打开；点按切换；点空白关闭。 */
export function HoverTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex" onClick={() => setOpen((v) => !v)}>
        {children}
      </span>
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <span className="absolute left-1/2 top-full z-50 mt-1.5 w-max max-w-48 -translate-x-1/2 rounded-[14px] border border-line bg-surface px-3 py-2 text-left elev">
            {label}
          </span>
        </>
      )}
    </span>
  );
}
```

`max-w-48` / `mt-1.5` / `px-3` / `py-2` / `rounded-[14px]` 与现有 `Menu` 浮层同档，不要发明 `px-[18px]`。

- [ ] **Step 2: 写 ChainAudience**

创建 `apps/web/src/pages/chain-home/chain-audience.tsx`（完整文件）：

```tsx
import type { ChainDto } from '@moment/dto';
import { Globe, Link } from 'lucide-react';
import { roleLabel } from '@/lib/roles';
import { Avatar } from '@/ui/Avatar';
import { HoverTip } from '@/ui/HoverTip';
import { Icon } from '@/ui/Icon';

export function ChainAudience({ chain }: { chain: ChainDto }) {
  const extra = chain.memberCount - chain.membersPreview.length;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center -space-x-2">
        {chain.membersPreview.map((m) => (
          <HoverTip
            key={m.userId}
            label={
              <>
                <span className="block text-sm text-ink">{m.nickname}</span>
                <span className="block text-xs text-muted">{roleLabel(m.role)}</span>
              </>
            }
          >
            <span className="relative inline-flex rounded-full ring-1 ring-bg">
              <Avatar name={m.nickname} src={m.avatarUrl} size={24} />
            </span>
          </HoverTip>
        ))}
        {extra > 0 && (
          <HoverTip label={`还有 ${extra} 人`}>
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-xs text-muted ring-1 ring-bg">
              +{extra}
            </span>
          </HoverTip>
        )}
      </div>
      {chain.visibility === 'link' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Icon icon={Link} size={14} />
          链接可看
        </span>
      )}
      {chain.visibility === 'public' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Icon icon={Globe} size={14} />
          公开
        </span>
      )}
    </div>
  );
}
```

不要给头像或标识加 `navigate`。不要请求 `client.listMembers`。不要在生成分享链接时 `updateChain({ visibility })`。

- [ ] **Step 3: 接入链页眉**

`apps/web/src/pages/chain-home/index.tsx`：增加

```ts
import { ChainAudience } from './chain-audience';
```

把现有 header 整块换成（`···` 仍在最右；简介在链名下方、左缘对齐链名）：

```tsx
      <header className="mb-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="min-w-0 truncate text-2xl font-medium">{chain.name}</h1>
              <ChainAudience chain={chain} />
            </div>
            {chain.description && <p className="mt-1 text-sm text-muted">{chain.description}</p>}
          </div>
          <Menu trigger={<KebabButton label="设置" />}>
            {(close) => (
              <MenuItem
                onClick={() => {
                  close();
                  navigate(`/chains/${chain.id}/settings`);
                }}
              >
                设置
              </MenuItem>
            )}
          </Menu>
        </header>
```

不要改 `ChainHomeService`（`loadChain` 已听 `chain:changed`）。不要改壳层 `Shell.tsx`。

- [ ] **Step 4: typecheck + lint**

Run:

```bash
pnpm --filter @moment/web typecheck
pnpm --filter @moment/web lint
```

Expected: 都通过。

手验清单（执行本任务的人在 `pnpm --filter @moment/web dev` 下勾）：

- 默认私密链：标题右侧有自己的头像，无徽章。
- `PATCH /api/chains/:id` body `{ "visibility": "link" }` 后刷新：出现「链接可看」。
- 再 PATCH `{ "visibility": "public" }` 后刷新：出现「公开」。
- 设置里生成再吊销一条分享链接，刷新：`visibility` 不变，徽章不因分享链接出现或消失。
- hover / 点按头像：两行，昵称 + 创建者/可记录/只看。
- 无法从 UI 凑 6 人时，可用测试库加成员后看 `+N`；`N` 必须等于 `memberCount - membersPreview.length`。
- 设置里只发邀请再回链页：头像人数不变。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/HoverTip.tsx \
  apps/web/src/pages/chain-home/chain-audience.tsx \
  apps/web/src/pages/chain-home/index.tsx
git commit -m "feat(web): 链页眉展示成员头像与可见性"
```

---

### Task 4: web — 改角色 / 移除 / 转让发射 `chain:changed`

**Files:**
- Modify: `apps/web/src/pages/chain-settings/chain-settings.service.ts`（`changeRole` / `removeMember` / `transferChain` 成功路径补 emit）
- Test: 无单测。验证 = typecheck + 确认 `createInvite` **没有**新 emit。

**Interfaces:**
- Consumes: 已有 `this.emit(type, payload, 'global')`；`ChainChangedPayload = { chainId: string; op: 'create' | 'update' | 'delete' }`（`apps/web/src/lib/events.ts`）。
- Produces: 下列方法成功后各发射一次（`op: 'update'`）。`createInvite` / `revokeInvite` 不新增 emit。`leaveChain` / `saveProfile` / `deleteChain` 已有发射，不要重复、不要删。

```ts
this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
```

- [ ] **Step 1: 改三个方法**

把 `changeRole` / `removeMember` / `transferChain` 换成（保留原有 load，只加 emit）：

```ts
  async changeRole(userId: string, role: 'editor' | 'viewer'): Promise<void> {
    await client.updateMemberRole(this.chainId, userId, role);
    await this.loadMembers();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async removeMember(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    await this.loadMembers();
    await this.loadChain();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async transferChain(userId: string): Promise<void> {
    await client.transferChain(this.chainId, userId);
    this.transferId = null;
    this.transferName = '';
    await this.loadMembers();
    await this.loadChain();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }
```

不要改 App 的 `apps/app/src/features/chain-settings/chain-settings.service.ts`。
不要给 `createInvite` 加 emit。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @moment/web typecheck`

Expected: PASS。

手验：设置里把某人从「可记录」改成「只看」，再回到 `/chains/:id`，该头像 hover 角色变成「只看」。移除一人后预览少一个。转让后新旧角色对调。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/chain-settings/chain-settings.service.ts
git commit -m "feat(web): 改角色/移除/转让后刷新链页预览"
```

---

## 自查

**Spec 覆盖：**

| Spec | Task |
|---|---|
| `ChainMemberPreview` + `ChainDto` 两字段，无 email/joinedAt | 1 |
| 五个 `ChainDto` 出口都带预览 | 2（`create`/`update`/`transfer` 走 `getById`） |
| 排序、切 5、挤掉最晚、邀请不算成员、list 不串链、PATCH 保预览、转让改角色、404 不泄露 | 2 测试表 |
| 一次成员查询 + 一次签名；空 `chainIds` 跳过；禁按链 Promise.all | 2 `attachPreviews` |
| 公开分享 DTO / 分享链接不改 visibility | 2 不改 share；3 手验 |
| 链名右侧头像 24 / 重叠 8 / +N 公式 / 浮层文案 / 三种 visibility | 3 |
| 不打 listMembers、不新建 Service | 3 |
| 改角色/移除/转让 emit；createInvite 不 emit；App 不补 emit | 4 |
| App typecheck | 2 Step 4 |

**占位符：** 无 TBD / TODO /「类似 Task N」/「适当处理」。

**类型一致：** `ChainMemberPreview` 四字段；`attachPreviews` / `toChainDto` 签名在 Task 2 钉死；`HoverTip` / `ChainAudience` 在 Task 3 钉死；emit payload 与 `ChainChangedPayload` 一致。
