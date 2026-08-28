# 时刻人物与地点 P2：server persons 词典 + moments personIds/place 写读 + 序列化 includePrivate 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「时刻人物与地点」的 server 读写闭环：`serializeMoments` 增加 `includePrivate` 选项（默认 false，链内路径显式 true 才输出 persons/place，share-album 不传即安全——spec §8 红线）并完成 P1 偏差 2 的 dto 收口（`MomentResponse.persons/place` 必填化 + `PublicShareMoment` 公开侧类型收紧）；新建 `src/persons/` 词典模块（GET/POST/PATCH/DELETE `/api/chains/:chainId/persons*`，读 viewer、写 editor，POST 幂等创建、PATCH 撞名 409）；moments create/update 集成 `personIds`（属链校验 400 `PERSON_NOT_IN_CHAIN` + PATCH 全量替换）与 `place`（§6 赋值表落库 + 仅坐标且 place_name 空时同事务写 `moment.geocode` outbox）；链删除 tx 补 `moment_persons`/`persons` 两行 delete。

**Architecture:** persons 模块完整镜像 `src/tags/` 范式（controller + service 两文件、service 直连 drizzle、路由经 `requireChainRole` 中间件、嵌套 `/api/chains/:chainId/persons`；tags 范式本身没有独立 repository 文件，见偏差 5）。moment 关联重建镜像 `tags/replace-moment-tags.ts`（新建 `persons/replace-moment-persons.ts`，在调用方业务事务内先删后插）。序列化保持「唯一出口」契约（CONVENTIONS §3.4）：`momentSerializer` 产出公开基形 `PublicShareMoment`（不含 persons/place 两键），`serializeMoments` 以**函数重载**区分两种返回形态——`{ includePrivate: true }` → `MomentResponse[]`（persons 按moment ids 一次 IN 查询 join persons 再内存分组，对齐 tags 批取范式；place 从 moment 行四列（lat/lng/name/source）拼装），缺省/false → `PublicShareMoment[]`（不查人物表，persons/place 两键完全不存在）。place source 赋值逻辑全在 server（新建 `moments/moment-place.ts` 纯函数），客户端请求不含 source（dto 已 strict）。

**Tech Stack:** routing-controllers 0.11 + TypeDI / drizzle-orm 0.45 mysql-core / zod ^3.22（勿用 v4 API）/ jest + supertest（真实 MySQL 测试库，`--runInBand`）/ dto 测试 tsx --test（node:test）。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§5 冲突规则中 P2 负责的手动路、§6 API 设计全节、§8 隐私红线、§9 测试策略、§11 P2 出口标准）

**上游契约:** `docs/superpowers/plans/2026-08-28-people-place-p1-dto-schema.md`（其 Produces 符号逐字消费）；执行编排 `docs/superpowers/prompts/2026-08-28-people-place-execution.md` T2 节。

## Global Constraints（只写本计划新增，通用约束继承 Phase 1 / 编排 §1）

- **source 只能 server 赋值**（spec §3/§6 赋值表）：坐标+名字→manual、仅坐标→exif、仅名字→manual、null→清空三列+source。客户端请求契约内无 source 字段（P1 dto strict 已拒绝），本计划不得在任何请求 schema 或 controller 中出现 source 入参。
- **`includePrivate` 默认 false**（spec §6/§8）：链内路径（moments create/list/get/update、feed、memories）显式传 `{ includePrivate: true }`；share-album 路径（`share-link.service.ts`）**不传**。隐私红线：share-album 输出零 persons/place **键**（不是空数组/null 值），双路序列化测试钉死（spec §9）。
- **`moment.extract` outbox 发射属 P4**（ai_extract_hash 判据，spec §5）：本计划**禁止**在 moments create/update 中做任何 hash 计算或 `moment.extract` 发射——只做 `moment.geocode`。P4 才补 extract 发射点。
- PATCH 语义（P1 已在 dto 钉死，server 落实）：`personIds !== undefined` 时全量替换（提交集合写 manual、集合外 manual+ai 一并删、空数组=清空）；`place !== undefined` 时按赋值表整体覆盖四列（null=清空）；均 undefined = 不变。
- 触库测试打 `.env` 指向的远程共享测试库：`--runInBand`、`afterAll(closeDb)`、禁止两个 jest 会话并行（瞬时 ECONNRESET 重跑同一命令即可）；严禁生产库。supertest server 由 `tests/helpers/fixtures.ts` 的 `listenLocal` 显式绑 127.0.0.1（新测试文件统一 `import { app } from '../helpers/fixtures.js'` 即继承）。
- 每 Task 一个 commit（conventional commits）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **outbox `moment.geocode` payload 用 camelCase `{ momentId, lat, lng }`**：spec §4 字面写 `{moment_id, lat, lng}`，但既有全部 outbox payload 都是 camelCase（`moment.created` 的 `{momentId, chainId, authorId, isBackfill}`、`recap.generate` 的 `{chainId, period}`），snake_case 会成孤例。本计划钉死 camelCase；P3（geocode worker）的 handler 以本计划 Produces 的 payload 形状为准。
2. **`OUTBOX_MOMENT_GEOCODE` 常量由本计划（T2）先行落地在 `src/outbox/types.ts`**：编排 T2/T3 的 owner 清单都含 moments 的 geocode 触发，但常量必须先于发射存在——T2 添加 `OUTBOX_MOMENT_GEOCODE = 'moment.geocode'` 与 `OutboxType` 联合成员（一行常量 + 一行类型），T3 只消费（handler 注册），不改名不改值。这是对两份 owner 清单重叠处的边界细化，非越界。
3. **POST `/persons` 幂等命中返回 200（新建 201）**：spec §6 只写「名归一化撞唯一约束 → 返回已存在行」，未定状态码。钉死：新建 201 / 幂等命中 200。实现经 `@Res()` 手动设码——routing-controllers 的 `@HttpCode` 装饰器会在 `ExpressDriver.handleSuccess` 里无条件覆盖状态码（已核实 `node_modules/routing-controllers/cjs/driver/express/ExpressDriver.js`：`action.successHttpCode` 存在即 `response.status(...)`；不存在则不碰状态，控制器内 `res.status()` 的值随框架 `response.json(result)` 发送）。
4. **POST `userId` 校验为链成员（400 `PERSON_USER_NOT_IN_CHAIN`）**：spec §2 说 user_id 是「可选链接到链成员用户」，未写校验与错误码。不校验会让任意已知 uuid 悬挂进词典（FK 只挡不存在的用户），污染 M3「爸爸发了哪些」查询语义。钉死：提供的 userId 必须是本链成员，否则 400 `PERSON_USER_NOT_IN_CHAIN`（UPPER_SNAKE 机器码，对齐 `PERSON_NOT_IN_CHAIN` 命名）。
5. **persons 模块不设独立 repository 文件**：编排 owner 清单写「controller/service/repository」，但同句的限定是「模块范式对齐 tags」——tags 范式是 controller + service 两文件（service 直连 drizzle，无 repository 层）。以范式为准：`person.controller.ts` + `person.service.ts`，另加镜像 `tags/replace-moment-tags.ts` 的 `replace-moment-persons.ts` 助手。
6. **dto 必填化 + `PublicShareMoment` 引出的 web/app 编译修复集（13 个 web 文件）超出编排 T2 owner 清单（server 文件）**：这是 P1 计划偏差 2 显式派给 P2 的收口（「P2 在实施 includePrivate 时收紧公开侧类型……并把 persons/place 必填化」）的**强制外溢**——必填化直接使 web 的 5 个 `MomentResponse` 测试 fixture 与 share-album → Timeline 组件链的类型不再编译。修复集全部为类型级机械修改（无行为变化、无样式改动，不触 web 设计规范），逐文件列在 Task 1，DoD 加 `pnpm --filter @moment/web typecheck/test` 与 `pnpm --filter @moment/app typecheck` 门禁。T5（P5 web）复审这批类型收口并接管后续演进（P5 展示 persons 时需处理公开路径无该字段的类型事实——这正是红线在类型层的体现）。
7. **PATCH place「仅名字」分支清空坐标**：赋值表字面（仅名字→manual）+ spec §2「place 三列同生同灭」——整体覆盖四列，用户要保留坐标须提交坐标+名字（manual）。非偏差，是对 §6 赋值表行的钉死说明（测试逐行覆盖）。
8. **serializer 架构：`momentSerializer` 返回公开基形，链内字段由 `serializeMoments` 拼接**：spec §6 只说「`serializeMoments` 增加 includePrivate 选项」。若 `momentSerializer` 恒输出 `persons: []`/`place: null` 再在 share 路径删键，类型既撒谎又留运行时陷阱。钉定：基函数返回 `PublicShareMoment`，重载的 `serializeMoments` 在 includePrivate 路径 spread 出完整 `MomentResponse`——两种形态都类型诚实，share 路径两键在 JSON 里完全不存在。

---

### Task 1: serializeMoments includePrivate + dto 类型收口（P1 偏差 2）+ 全端编译修复

**Files:**
- Modify: `packages/dto/src/moments.ts`（persons/place 必填化——替换 P1 落地的可选声明）
- Modify: `packages/dto/src/moments.test.ts`（翻转 P1 的「可省略」断言）
- Modify: `packages/dto/src/share.ts`（`PublicShareMoment` + `PublicShareResponse.moments` 收紧）
- Test: `packages/dto/src/share.test.ts`（追加 PublicShareMoment 类型用例）
- Modify: `apps/server/src/moments/moment-serializer.ts`（includePrivate + persons/place 批取 + 重载签名）
- Modify: `apps/server/src/moments/moment.service.ts`（create/list/get/update 四处传 `{ includePrivate: true }`）
- Modify: `apps/server/src/feed/feed.service.ts`、`apps/server/src/memories/memories.service.ts`（传 true）
- Modify: `apps/server/src/share/share-link.service.ts`（仅加红线注释，调用不变）
- Test: `apps/server/tests/moments/moment-serializer.test.ts`（追加公开基形单测）
- Create: `apps/server/tests/moments/moment-private-serialization.test.ts`（双路红线，spec §9）
- Modify（web 编译修复，见偏差 6，全部类型级无行为变化）:
  - `apps/web/src/pages/share-album/share-album.service.ts`
  - `apps/web/src/timeline/timeline.tsx`、`apps/web/src/timeline/group-by-date.ts`
  - `apps/web/src/timeline/moment-sheet.tsx`、`apps/web/src/timeline/moment-sheet.service.ts`、`apps/web/src/timeline/reaction-bar.tsx`
  - `apps/web/src/chain/aggregate-views.tsx`、`apps/web/src/lib/template.ts`
  - 测试 fixture（加 `persons: [], place: null`）：`apps/web/src/lib/memories.test.ts`、`apps/web/src/memories/memories.service.test.ts`、`apps/web/src/memories/memories-entry.test.tsx`、`apps/web/src/pages/timeline-variants.test.tsx`、`apps/web/src/pages/chain-home/chain-home.test.tsx`

**Interfaces:**
- Consumes（P1 Produces 逐字引用）:
  - `@moment/dto`：`PersonBrief`（`{id, name, userId, source}`）、`MomentPlace`（`{lat, lng, name, source}`）、`MomentResponse`（P1 落地时 `persons?: PersonBrief[]` / `place?: MomentPlace | null` 可选形态，本 Task 收紧）、`momentPersonIdsSchema` / `placeInputSchema`（本 Task 不消费运行时，仅类型上下游）
  - server：`persons` / `momentPersons`（`src/db/schema.js` barrel，P1 落地）、`Moment` 行类型已含 `placeLat/placeLng/placeName/placeSource/aiExtractHash`、`insertPerson` / `attachPerson`（`tests/helpers/fixtures.js`，P1 落地）
  - 既有 `serializeMoments(rows, viewerId?)` / `momentSerializer(m, extras)` / `SerializerExtras`（`src/moments/moment-serializer.ts`）
- Produces（P3–P7 依赖）:
  - `serializeMoments(rows: Moment[], viewerId?: string | null, options: { includePrivate: true }): Promise<MomentResponse[]>`（重载 1：链内路径）
  - `serializeMoments(rows: Moment[], viewerId?: string | null, options?: { includePrivate?: boolean }): Promise<PublicShareMoment[]>`（重载 2：公开路径/缺省）
  - `momentSerializer(m: MomentLike, extras: SerializerExtras): PublicShareMoment`（返回类型收紧；persons/place 不在基函数输出）
  - dto `PublicShareMoment = Omit<MomentResponse, 'persons' | 'place'>`（`share.ts` 导出）
  - dto `MomentResponse.persons: PersonBrief[]` / `place: MomentPlace | null`（必填，P1 偏差 2 收口；P5/P6 消费）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/moments/moment-private-serialization.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** 造一条带人物（manual）+ 地点（exif 坐标、名字待回填）的 moment。 */
async function seedRichMoment(chainId: string, authorId: string): Promise<{ momentId: string; personId: string }> {
  const momentId = await insertMoment({ chainId, authorId, happenedAt: new Date('2026-08-01T00:00:00Z') });
  const personId = await insertPerson({ chainId, name: '外婆' });
  await attachPerson(momentId, personId, 'manual');
  await db
    .update(moments)
    .set({ placeLat: 39.9042, placeLng: 116.4074, placeName: null, placeSource: 'exif' })
    .where(eq(moments.id, momentId));
  return { momentId, personId };
}

describe('serializeMoments includePrivate 双路（spec §6/§8/§9 隐私红线）', () => {
  it('链内路径：GET /api/chains/:chainId/moments 输出含 persons/place（批取，含 source）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const { momentId, personId } = await seedRichMoment(chainId, owner.id);

    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const item = res.body.items.find((m: { id: string }) => m.id === momentId);
    expect(item.persons).toEqual([{ id: personId, name: '外婆', userId: null, source: 'manual' }]);
    expect(item.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
  });

  it('链内路径：GET /api/moments/:id 输出含 persons/place', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const { momentId, personId } = await seedRichMoment(chainId, owner.id);

    const res = await request(app).get(`/api/moments/${momentId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.persons).toEqual([{ id: personId, name: '外婆', userId: null, source: 'manual' }]);
    expect(res.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
  });

  it('链内路径：GET /api/feed?chain_ids= 输出含 persons/place', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const { momentId, personId } = await seedRichMoment(chainId, owner.id);

    const res = await request(app)
      .get(`/api/feed?chain_ids=${chainId}&order=happened_at`)
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    const item = res.body.moments.find((m: { id: string }) => m.id === momentId);
    expect(item.persons).toEqual([{ id: personId, name: '外婆', userId: null, source: 'manual' }]);
    expect(item.place.source).toBe('exif');
  });

  it('链内路径：无人物无地点的 moment 输出 persons=[]、place=null（字段必存在，P1 偏差 2 收口）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date('2026-08-01T00:00:00Z') });

    const res = await request(app).get(`/api/chains/${chainId}/moments`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].persons).toEqual([]);
    expect(res.body.items[0].place).toBeNull();
  });

  it('share-album：GET /api/public/share/:token 输出零 persons/place 键（隐私红线）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    await seedRichMoment(chainId, owner.id);

    const link = await request(app).post(`/api/chains/${chainId}/share-links`).set(auth(owner.token)).send({});
    expect(link.status).toBe(201);

    const res = await request(app).get(`/api/public/share/${link.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.moments).toHaveLength(1);
    // 红线断言：键完全不存在（不是空数组/null 值）
    expect('persons' in res.body.moments[0]).toBe(false);
    expect('place' in res.body.moments[0]).toBe(false);
    expect(Object.keys(res.body.moments[0])).not.toContain('persons');
    expect(Object.keys(res.body.moments[0])).not.toContain('place');
  });
});
```

Modify `apps/server/tests/moments/moment-serializer.test.ts` — 文件末尾追加：
```ts
describe('momentSerializer 公开基形（spec §8：persons/place 不在基函数输出）', () => {
  it('输出不含 persons/place 键——两键由 serializeMoments 在 includePrivate 路径拼接', () => {
    const res = momentSerializer(moment, {
      media: [],
      author: { id: 'u-1', nickname: 'Alice', avatarUrl: null },
    });
    expect('persons' in res).toBe(false);
    expect('place' in res).toBe(false);
    expect(Object.keys(res)).not.toContain('persons');
    expect(Object.keys(res)).not.toContain('place');
  });
});
```

Modify `packages/dto/src/share.test.ts` — import 行替换为：
```ts
import { createShareLinkInputSchema, publicShareQuerySchema, type PublicShareChainInfo, type PublicShareMoment } from './share.js';
```
文件末尾追加：
```ts
test('PublicShareMoment 不含 persons/place（spec §8 红线，P1 偏差 2 收口）', () => {
  // tsx --test 不做类型检查——本用例钉运行时形状；「多出的 persons 会编译报错」由
  // pnpm --filter @moment/dto build（tsc）把关：PublicShareMoment 上不存在这两个属性。
  const m: PublicShareMoment = {
    id: 'm1',
    chainId: 'c1',
    author: { id: 'u1', nickname: 'a', avatarUrl: null },
    type: 'text',
    content: '第一次翻身',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-01T00:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
  assert.equal('persons' in m, false);
  assert.equal('place' in m, false);
});
```

Modify `packages/dto/src/moments.test.ts` — P1 落地的 `MomentResponse：含 persons/place 字段可赋值；P1 可省略（spec §6，见偏差 2）` 用例末尾，把「P1 可选」段替换为「P2 收口」段。删除下列 P1 代码块：
```ts
  // P1 可选（偏差 2）：momentSerializer() 在 P1 不产出 persons/place，
  // 显式置 undefined 的字面量也必须通过类型检查（必填会破 server typecheck 与 web 测试）
  const legacy: MomentResponse = { ...res, persons: undefined, place: undefined };
  assert.equal(legacy.persons, undefined);
  assert.equal(legacy.place, undefined);
```
同一用例改名为 `MomentResponse：含 persons/place 字段可赋值（P2 已必填化）`，并在 `assert.equal(res.place!.source, 'exif');` 之后追加：
```ts
  // P2 收口（P1 偏差 2）：persons/place 必填。tsx 不做类型检查，
  // 必填由 pnpm --filter @moment/dto build（tsc）把关；运行时断言钉字段语义。
  assert.equal(Array.isArray(res.persons), true);
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-private-serialization.test.ts`
Expected: FAIL——前四个「链内路径」用例红（`item.persons` / `item.place` 为 undefined，serializer 未产出）；第五个 share-album 用例此时恰好绿（现状本就不输出这两键——它是防回归钉子，不是红灯来源）。红灯以链内路径用例为准。

> 说明：Step 3–5 是一个编译单元——serializer 的返回类型 `PublicShareMoment`（Step 3）与 dto 的收口（Step 5）互相依赖，中间不单独编译验证，统一在 Step 7/8 跑测试与全端门禁。

- [ ] **Step 3: 实现 serializer includePrivate**

Modify `apps/server/src/moments/moment-serializer.ts`：

import 区替换为（加 `PersonBrief` / `PublicShareMoment` 类型与 `momentPersons` / `persons` 表）：
```ts
import type {
  AuthorSummary,
  MomentResponse,
  PersonBrief,
  PublicShareMoment,
  ReactionSummary,
  TagBrief,
} from '@moment/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { avatarUrlsByUserIds } from '../auth/avatar.js';
import { db } from '../db/index.js';
import { comments, media, momentPersons, momentTags, persons, reactions, tags, users, type Moment } from '../db/schema.js';
```

`momentSerializer` 的 doc 注释与返回类型替换（函数体不变）：
```ts
/**
 * moment → API 响应的唯一出口（CONVENTIONS §3.4）；media 只出稳定入口相对路径。
 * 返回公开基形 PublicShareMoment（不含 persons/place）——两键是链内私有字段，由
 * serializeMoments 在 includePrivate 路径拼接（spec §6/§8：share-album 输出零
 * persons/place 键，默认偏向安全侧）。
 */
export function momentSerializer(m: MomentLike, extras: SerializerExtras): PublicShareMoment {
```

`serializeMoments` 整体替换为（重载 + 批取 persons + place 拼装）：
```ts
/** persons 批取行的最小形状（moment_persons join persons） */
interface PersonBriefRow {
  momentId: string;
  id: string;
  name: string;
  userId: string | null;
  source: 'manual' | 'ai';
}

/**
 * 批量序列化：media / author / tags / 评论数 / 表情分组 / myReaction 全部一页一次
 * IN + GROUP BY 查出（spec §5.1，严禁 N+1）。viewerId 缺省时 myReaction 恒 null。
 *
 * includePrivate（默认 false，spec §6/§8 红线）：
 * - true（链内路径：feed/时间线/详情/编辑回读）：额外按 moment ids 一次 IN 查询
 *   moment_persons join persons（对齐 tags 批取范式）再内存分组，place 从 moment 行
 *   四列拼装；输出 MomentResponse——persons/place 必有。
 * - false/缺省（公开路径：share-album）：不查人物表，输出 PublicShareMoment——
 *   persons/place 两键完全不存在。默认偏向安全侧的理由是失败模式不对称：内部调用方
 *   忘了传只是 UI 缺字段（可见易修），分享路径忘了剥离就是隐私泄漏（不可见有害）。
 */
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null,
  options: { includePrivate: true },
): Promise<MomentResponse[]>;
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null,
  options?: { includePrivate?: boolean },
): Promise<PublicShareMoment[]>;
export async function serializeMoments(
  rows: Moment[],
  viewerId?: string | null,
  options: { includePrivate?: boolean } = {},
): Promise<(MomentResponse | PublicShareMoment)[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const includePrivate = options.includePrivate === true;

  const [mediaRows, authorRows, tagRows, commentRows, reactionRows, myRows, personRows] = await Promise.all([
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
    includePrivate
      ? db
          .select({
            momentId: momentPersons.momentId,
            id: persons.id,
            name: persons.name,
            userId: persons.userId,
            source: momentPersons.source,
          })
          .from(momentPersons)
          .innerJoin(persons, eq(persons.id, momentPersons.personId))
          .where(inArray(momentPersons.momentId, ids))
          .orderBy(asc(momentPersons.momentId), asc(momentPersons.personId))
      : Promise.resolve([] as PersonBriefRow[]),
  ]);

  // poster 行绑了同一 momentId 会被查出，必须从内容媒体中排除——否则以第 2 条媒体泄漏，
  // 破坏 type=video 恰 1 条视频媒体的契约。排除只存在于批量函数；单条出口消费组装结果。
  const posterIds = new Set(
    mediaRows.map((r) => r.posterMediaId).filter((id): id is string => id !== null)
  );
  const mediaBy = new Map<string, MediaLike[]>();
  for (const m of mediaRows) {
    if (!m.momentId) continue;
    if (posterIds.has(m.id)) continue;
    const list = mediaBy.get(m.momentId) ?? [];
    list.push(m);
    mediaBy.set(m.momentId, list);
  }
  const avatarBy = await avatarUrlsByUserIds(authorRows.map((a) => a.id));
  const authorBy = new Map(
    authorRows.map((a) => [a.id, { id: a.id, nickname: a.nickname, avatarUrl: avatarBy.get(a.id) ?? null }])
  );
  const tagsBy = new Map<string, TagBrief[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.momentId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsBy.set(t.momentId, list);
  }
  const personsBy = new Map<string, PersonBrief[]>();
  for (const p of personRows) {
    const list = personsBy.get(p.momentId) ?? [];
    list.push({ id: p.id, name: p.name, userId: p.userId, source: p.source });
    personsBy.set(p.momentId, list);
  }
  const commentCountBy = new Map(commentRows.map((c) => [c.momentId, Number(c.count)]));
  const reactionBy = new Map<string, ReactionSummary[]>();
  for (const r of reactionRows) {
    const list = reactionBy.get(r.momentId) ?? [];
    list.push({ emoji: r.emoji, count: Number(r.count) });
    reactionBy.set(r.momentId, list);
  }
  const myBy = new Map(myRows.map((r) => [r.momentId, r.emoji]));

  return rows.map((r) => {
    const base = momentSerializer(r, {
      media: mediaBy.get(r.id) ?? [],
      author: authorBy.get(r.authorId) ?? { id: r.authorId, nickname: '', avatarUrl: null },
      tags: tagsBy.get(r.id) ?? [],
      counts: {
        commentCount: commentCountBy.get(r.id) ?? 0,
        reactions: reactionBy.get(r.id) ?? [],
        myReaction: myBy.get(r.id) ?? null,
      },
    });
    if (!includePrivate) return base;
    return {
      ...base,
      persons: personsBy.get(r.id) ?? [],
      // place 三列 + source 同生同灭（spec §2）：placeSource 为 null 即无地点，整体 null
      place:
        r.placeSource === null
          ? null
          : { lat: r.placeLat, lng: r.placeLng, name: r.placeName, source: r.placeSource },
    };
  });
}
```

- [ ] **Step 4: 调用方传 includePrivate（全集，已逐文件核实）**

`serializeMoments` 调用点全集共 7 处（grep `src/` 核实）：链内 6 处传 true、share 1 处不传。

`apps/server/src/moments/moment.service.ts`（4 处）：
- create 末尾：`return (await serializeMoments([created], userId, { includePrivate: true }))[0];`
- list：`return { items: await serializeMoments(page.rows, userId, { includePrivate: true }), nextCursor: page.nextCursor };`
- get：`return (await serializeMoments([m], userId, { includePrivate: true }))[0];`
- update 末尾：`return (await serializeMoments([updatedRow], userId, { includePrivate: true }))[0];`

`apps/server/src/feed/feed.service.ts` feed()：
`return { moments: await serializeMoments(page.rows, userId, { includePrivate: true }), nextCursor: page.nextCursor };`

`apps/server/src/memories/memories.service.ts` today()：
`years.push({ year, moments: await serializeMoments(list, userId, { includePrivate: true }) });`

`apps/server/src/share/share-link.service.ts` getSharedChain() —— **调用不变**（`serializeMoments(page.rows)`），仅在调用上方注释补一行：
```ts
    // 隐私红线（spec §8）：不传 includePrivate（默认 false）——公开相册输出零 persons/place。
    moments: await serializeMoments(page.rows),
```

- [ ] **Step 5: dto 收口**

Modify `packages/dto/src/moments.ts` — 把 P1 落地的两段可选声明（`persons?: PersonBrief[]` 与 `place?: MomentPlace | null` 及其注释）替换为：
```ts
  /**
   * moment 上的人物（含 AI 抽取行；source 取自 moment_persons 关联行）。
   * 链内路径（serializeMoments 传 includePrivate:true）必产出；公开分享路径的
   * PublicShareMoment 不含本字段（spec §8 红线，P1 偏差 2 由 P2 收口为必填）。
   */
  persons: PersonBrief[];
  /** 地点；无地点为 null。链内路径必产出；公开分享路径不含（spec §8 红线）。 */
  place: MomentPlace | null;
```

Modify `packages/dto/src/share.ts` — import 行的 `import type { MomentResponse } from './moments.js';` 保持，在 `PublicShareChainInfo` 接口之前追加：
```ts
/**
 * 公开分享相册的 moment 视图（spec §8 红线）：不含 persons/place——家庭人物关系与
 * 精确坐标绝不随公开链接外发。链内完整形态是 MomentResponse（persons/place 必填）。
 */
export type PublicShareMoment = Omit<MomentResponse, 'persons' | 'place'>;
```
`PublicShareResponse.moments` 字段替换为：
```ts
  moments: PublicShareMoment[];
```
（原注释行 `/** 匿名只读视图：计数只读展示（commentCount/reactions），myReaction 恒 null */` 保持不变；`moments` 字段如需注释，写 `/** 时刻列表（公开形：无 persons/place，spec §8 红线） */`。）

- [ ] **Step 6: web 编译修复集（类型级，无行为变化）**

原理：`MomentResponse`（超集）可结构赋值给 `PublicShareMoment`，share 页是唯一 `PublicShareMoment[]` 来源——把 Timeline 组件链的 props 从 `MomentResponse` 放宽为 `PublicShareMoment` 后，链内（MomentResponse[]）与分享（PublicShareMoment[]）两条数据流都合法；P5 做卡片 persons 展示时，类型层会强制处理「公开路径无该字段」的事实（红线在类型层生效）。

1. `apps/web/src/pages/share-album/share-album.service.ts` — import 行改为 `import type { AggregateResponse, PublicShareMoment, RecapDto, TemplateManifest } from '@moment/dto';`；字段声明改为 `moments: PublicShareMoment[] = [];`
2. `apps/web/src/timeline/timeline.tsx` — import 改为 `import type { PublicShareMoment, TemplateManifest } from '@moment/dto';`；props `moments: MomentResponse[]` → `moments: PublicShareMoment[]`；`ageLabelOf?: (m: MomentResponse) => string;` → `ageLabelOf?: (m: PublicShareMoment) => string;`；`const renderSheet = (m: MomentResponse) => (` → `const renderSheet = (m: PublicShareMoment) => (`
3. `apps/web/src/timeline/group-by-date.ts` — import 改为 `import type { PublicShareMoment } from '@moment/dto';`；`DateGroup.moments: MomentResponse[]` → `PublicShareMoment[]`；`groupMomentsByDate(moments: MomentResponse[])` → `(moments: PublicShareMoment[])`；`new Map<string, MomentResponse[]>()` → `new Map<string, PublicShareMoment[]>()`
4. `apps/web/src/timeline/moment-sheet.tsx` — import 改为 `import { type MomentMedia, type PublicShareMoment } from '@moment/dto';`；props `moment: MomentResponse;` → `moment: PublicShareMoment;`
5. `apps/web/src/timeline/moment-sheet.service.ts` — import 改为 `import type { CommentDto, PublicShareMoment } from '@moment/dto';`；`moment: MomentResponse | null = null;` → `moment: PublicShareMoment | null = null;`；`hydrate(moment: MomentResponse): void` → `hydrate(moment: PublicShareMoment): void`（`hydrate(momentProp)` 传入的是已放宽的 prop 类型）
6. `apps/web/src/timeline/reaction-bar.tsx` — import 改为 `import { REACTION_EMOJIS, type PublicShareMoment } from '@moment/dto';`；`moment: MomentResponse;` → `moment: PublicShareMoment;`
7. `apps/web/src/chain/aggregate-views.tsx` — import 改为 `import type { AggregateResponse, PublicShareMoment } from '@moment/dto';`；`TripsView` 的 `moments: MomentResponse[]` → `PublicShareMoment[]`；`AggregateView` props 的 `moments: MomentResponse[]` → `PublicShareMoment[]`
8. `apps/web/src/lib/template.ts` — import 改为 `import type { PublicShareMoment, TemplateManifest } from '@moment/dto';`；`TripSection.moments`、`groupMomentsByTrips(moments: PublicShareMoment[], ...)` 返回类型 `{ sections: TripSection[]; outside: PublicShareMoment[] }`、`const outside: PublicShareMoment[] = [];` 同步替换
9. 测试 fixture（`tags: [...]` 行之后统一加两行 `persons: [],`、`place: null,`）：
   - `apps/web/src/lib/memories.test.ts`（`moment()` 工厂）
   - `apps/web/src/memories/memories.service.test.ts`（`moment()` 工厂）
   - `apps/web/src/memories/memories-entry.test.tsx`（`moment()` 工厂）
   - `apps/web/src/pages/timeline-variants.test.tsx`（`TEXT_MOMENT` 字面量；`TWO_IMAGE_MOMENT` 经 spread 继承，无需改）
   - `apps/web/src/pages/chain-home/chain-home.test.tsx`（`TEXT_MOMENT` 与 `IMAGE_MOMENT` 两个字面量）

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-private-serialization.test.ts tests/moments/moment-serializer.test.ts`
Expected: PASS，双路 5 用例 + 基形 1 用例全过。

- [ ] **Step 8: 全端门禁**

Run（逐条 exit 0）：
```bash
pnpm --filter @moment/dto test && pnpm --filter @moment/dto build && pnpm --filter @moment/dto lint
pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
pnpm --filter @moment/api-client typecheck && pnpm --filter @moment/api-client test
pnpm --filter @moment/web typecheck && pnpm --filter @moment/web test
pnpm --filter @moment/app typecheck
```
Expected: 全绿。`@moment/server test` 全量回归放 Task 3 末尾统一跑（本 Task 只跑受影响文件 + typecheck；若编排要求每 Task 全量，此处直接跑 `pnpm --filter @moment/server test` 亦可）。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add packages/dto/src/moments.ts packages/dto/src/moments.test.ts packages/dto/src/share.ts packages/dto/src/share.test.ts \
  apps/server/src/moments/moment-serializer.ts apps/server/src/moments/moment.service.ts apps/server/src/feed/feed.service.ts \
  apps/server/src/memories/memories.service.ts apps/server/src/share/share-link.service.ts \
  apps/server/tests/moments/moment-serializer.test.ts apps/server/tests/moments/moment-private-serialization.test.ts \
  apps/web/src/pages/share-album/share-album.service.ts apps/web/src/timeline/timeline.tsx apps/web/src/timeline/group-by-date.ts \
  apps/web/src/timeline/moment-sheet.tsx apps/web/src/timeline/moment-sheet.service.ts apps/web/src/timeline/reaction-bar.tsx \
  apps/web/src/chain/aggregate-views.tsx apps/web/src/lib/template.ts \
  apps/web/src/lib/memories.test.ts apps/web/src/memories/memories.service.test.ts apps/web/src/memories/memories-entry.test.tsx \
  apps/web/src/pages/timeline-variants.test.tsx apps/web/src/pages/chain-home/chain-home.test.tsx
git commit -m "feat(server): serialize moment persons/place behind includePrivate and tighten dto types"
```

---

### Task 2: persons 词典模块（CRUD + 幂等创建 + 改名冲突 + 删除级联 + 链删除清理）

**Files:**
- Create: `apps/server/src/persons/person.controller.ts`
- Create: `apps/server/src/persons/person.service.ts`
- Modify: `apps/server/src/app.ts`（controllers 数组注册 `PersonController`）
- Modify: `apps/server/src/chains/chain.service.ts`（删除 tx 补 `moment_persons`、`persons` 两行 delete）
- Create: `apps/server/tests/persons/persons.test.ts`

**Interfaces:**
- Consumes（P1 Produces 逐字引用）:
  - `@moment/dto`：`personCreateInputSchema`（`{name: trim 1..50, userId?: uuid}`）、`personPatchInputSchema`（`{name: trim 1..50}`）、`PersonCreateInput` / `PersonPatchInput` / `PersonResponse`（`{id, name, userId}`）/ `PersonListResponse`（`{persons: PersonResponse[]}`）
  - server：`persons` / `momentPersons`（`src/db/schema.js`）、`requireChainRole`（`src/chains/require-chain-role.js`，`@UseBefore(requireChainRole('viewer'|'editor'))`）
  - 测试：`resetDb()/closeDb()`、`registerUser/createChain/addMember/insertMoment/attachPerson`（`tests/helpers/*.js`，`attachPerson` 为 P1 扩展；person 全部经 HTTP POST 创建，不直接用 `insertPerson`）
- Produces（P3–P7 依赖）:
  - 路由：`GET /api/chains/:chainId/persons`（viewer）、`POST /api/chains/:chainId/persons`（editor，新建 201 / 幂等命中 200）、`PATCH /api/chains/:chainId/persons/:personId`（editor）、`DELETE /api/chains/:chainId/persons/:personId`（editor，204）——P5/P6 api-client 消费
  - `normalizePersonName(name: string): string`（`person.service.ts` 导出：trim + 内部连续空白折叠为单空格；P4 AI 抽取词典 upsert 消费，spec §2 名归一化唯一实现）
  - `PersonService.create(chainId, input): Promise<{ person: PersonResponse; created: boolean }>`
  - `PersonService.rename(chainId, personId, input): Promise<PersonResponse>` / `remove(chainId, personId): Promise<void>`
  - 错误码：`PERSON_NAME_CONFLICT`（409）、`PERSON_NOT_FOUND`（404）、`PERSON_USER_NOT_IN_CHAIN`（400）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/persons/persons.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, persons } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { addMember, app, attachPerson, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

/** 标准三人场景：owner + viewer 在链内，outsider 在链外（镜像 tags.test.ts）。 */
async function setup() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const outsider = await registerUser();
  const chainId = await createChain(owner.id);
  await addMember(chainId, viewer.id, 'viewer');
  return { owner, viewer, outsider, chainId };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/chains/:chainId/persons', () => {
  it('viewer 可读，按 name 升序，字段恰为 {id, name, userId}（spec §6 词典响应无 source/momentCount）', async () => {
    const { owner, viewer, chainId } = await setup();
    const waipo = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const baba = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '爸爸', userId: owner.id });
    expect(waipo.status).toBe(201);
    expect(baba.status).toBe(201);

    const res = await request(app).get(`/api/chains/${chainId}/persons`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    // utf8mb4 下 '外'(U+5916) < '爸'(U+7238)，name 升序实际为 外婆 → 爸爸
    expect(res.body.persons.map((p: { name: string }) => p.name)).toEqual(['外婆', '爸爸']);
    expect(res.body.persons[0]).toEqual({ id: waipo.body.id, name: '外婆', userId: null });
    expect(res.body.persons[1]).toEqual({ id: baba.body.id, name: '爸爸', userId: owner.id });
  });

  it('非成员 404 CHAIN_NOT_FOUND；未登录 401', async () => {
    const { outsider, chainId } = await setup();
    const forbidden = await request(app).get(`/api/chains/${chainId}/persons`).set(auth(outsider.token));
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('CHAIN_NOT_FOUND');

    const anon = await request(app).get(`/api/chains/${chainId}/persons`);
    expect(anon.status).toBe(401);
  });
});

describe('POST /api/chains/:chainId/persons', () => {
  it('editor 创建 201；owner 亦可', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');

    const created = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(editor.token))
      .send({ name: '朵朵' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), name: '朵朵', userId: null });

    const byOwner = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '爷爷' });
    expect(byOwner.status).toBe(201);
  });

  it('幂等创建（spec §6）：trim + 内部连续空白归一化撞名 → 返回已存在行 200，词典仍只有一行', async () => {
    const { owner, chainId } = await setup();
    const first = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '王 叔叔' });
    expect(first.status).toBe(201);

    const again = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '  王   叔叔 ' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    const rows = await db.select().from(persons).where(eq(persons.chainId, chainId));
    expect(rows).toHaveLength(1);
  });

  it('跨链同名不冲突：各自 201（uk 是 (chain_id, name)）', async () => {
    const { owner } = await setup();
    const c1 = await createChain(owner.id, '链一');
    const c2 = await createChain(owner.id, '链二');
    const r1 = await request(app).post(`/api/chains/${c1}/persons`).set(auth(owner.token)).send({ name: '朵朵' });
    const r2 = await request(app).post(`/api/chains/${c2}/persons`).set(auth(owner.token)).send({ name: '朵朵' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.id).not.toBe(r2.body.id);
  });

  it('viewer 403；非成员 404；空名 400 VALIDATION_ERROR（用 owner——角色中间件先于 zod parse）', async () => {
    const { owner, viewer, outsider, chainId } = await setup();
    const asViewer = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(viewer.token))
      .send({ name: 'x' });
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.error.code).toBe('CHAIN_ROLE_INSUFFICIENT');

    const notMember = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(outsider.token))
      .send({ name: 'x' });
    expect(notMember.status).toBe(404);

    const badBody = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '' });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('userId 非本链成员 → 400 PERSON_USER_NOT_IN_CHAIN', async () => {
    const { owner, chainId } = await setup();
    const outsider = await registerUser();
    const res = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '路人', userId: outsider.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PERSON_USER_NOT_IN_CHAIN');
  });
});

describe('PATCH /api/chains/:chainId/persons/:personId', () => {
  it('editor 改名 200；归一化后同名（含 trim）幂等返回', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const created = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(editor.token))
      .send({ name: '姥姥' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: created.body.id, name: '姥姥', userId: null });

    const noop = await request(app)
      .patch(`/api/chains/${chainId}/persons/${created.body.id}`)
      .set(auth(owner.token))
      .send({ name: ' 姥姥 ' });
    expect(noop.status).toBe(200);
    expect(noop.body.name).toBe('姥姥');
  });

  it('撞名归一化 → 409 PERSON_NAME_CONFLICT（v1 不做合并，spec §6）', async () => {
    const { owner, chainId } = await setup();
    const a = await request(app).post(`/api/chains/${chainId}/persons`).set(auth(owner.token)).send({ name: '外婆' });
    const b = await request(app).post(`/api/chains/${chainId}/persons`).set(auth(owner.token)).send({ name: '姥姥' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const res = await request(app)
      .patch(`/api/chains/${chainId}/persons/${a.body.id}`)
      .set(auth(owner.token))
      .send({ name: ' 姥姥 ' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERSON_NAME_CONFLICT');
  });

  it('viewer 403；他链 personId 404 PERSON_NOT_FOUND（防跨链探测）；不存在 404', async () => {
    const { owner, viewer, chainId } = await setup();
    const otherChain = await createChain(owner.id, '他链');
    const foreign = await request(app)
      .post(`/api/chains/${otherChain}/persons`)
      .set(auth(owner.token))
      .send({ name: '外人' });
    expect(foreign.status).toBe(201);

    const asViewer = await request(app)
      .patch(`/api/chains/${chainId}/persons/${foreign.body.id}`)
      .set(auth(viewer.token))
      .send({ name: 'x' });
    expect(asViewer.status).toBe(403);

    const crossChain = await request(app)
      .patch(`/api/chains/${chainId}/persons/${foreign.body.id}`)
      .set(auth(owner.token))
      .send({ name: '改名' });
    expect(crossChain.status).toBe(404);
    expect(crossChain.body.error.code).toBe('PERSON_NOT_FOUND');

    const missing = await request(app)
      .patch(`/api/chains/${chainId}/persons/00000000-0000-4000-8000-000000000000`)
      .set(auth(owner.token))
      .send({ name: '改名' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PERSON_NOT_FOUND');
  });
});

describe('DELETE /api/chains/:chainId/persons/:personId', () => {
  it('editor 可删：先删 moment_persons 关联再删词典行（一个事务），moment 本体不动', async () => {
    const { owner, chainId } = await setup();
    const editor = await registerUser();
    await addMember(chainId, editor.id, 'editor');
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    expect(person.status).toBe(201);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(momentId, person.body.id);

    const res = await request(app)
      .delete(`/api/chains/${chainId}/persons/${person.body.id}`)
      .set(auth(editor.token));
    expect(res.status).toBe(204);

    expect(await db.select().from(momentPersons).where(eq(momentPersons.personId, person.body.id))).toHaveLength(0);
    expect(await db.select().from(persons).where(eq(persons.id, person.body.id))).toHaveLength(0);
    const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
    expect(m.id).toBe(momentId);
  });

  it('viewer 403；他链 personId 404；不存在 404 PERSON_NOT_FOUND', async () => {
    const { owner, viewer, chainId } = await setup();
    const otherChain = await createChain(owner.id, '他链');
    const foreign = await request(app)
      .post(`/api/chains/${otherChain}/persons`)
      .set(auth(owner.token))
      .send({ name: '外人' });
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });

    const asViewer = await request(app)
      .delete(`/api/chains/${chainId}/persons/${person.body.id}`)
      .set(auth(viewer.token));
    expect(asViewer.status).toBe(403);

    const crossChain = await request(app)
      .delete(`/api/chains/${chainId}/persons/${foreign.body.id}`)
      .set(auth(owner.token));
    expect(crossChain.status).toBe(404);
    expect(crossChain.body.error.code).toBe('PERSON_NOT_FOUND');

    const missing = await request(app)
      .delete(`/api/chains/${chainId}/persons/00000000-0000-4000-8000-000000000000`)
      .set(auth(owner.token));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PERSON_NOT_FOUND');
  });
});

describe('链删除清理（chain.service 删除 tx，spec §2 FK 不写 onDelete 的镜像范式）', () => {
  it('删链后 persons / moment_persons 全清', async () => {
    const { owner, chainId } = await setup();
    const person = await request(app)
      .post(`/api/chains/${chainId}/persons`)
      .set(auth(owner.token))
      .send({ name: '外婆' });
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    await attachPerson(momentId, person.body.id);

    const res = await request(app).delete(`/api/chains/${chainId}`).set(auth(owner.token));
    expect(res.status).toBe(204);

    expect(await db.select().from(persons).where(eq(persons.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(momentPersons)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/persons/persons.test.ts`
Expected: FAIL，`Cannot find module '../../src/persons/person.service.js'` 或 404（路由未注册）。

- [ ] **Step 3: 实现 person.service.ts**

Create `apps/server/src/persons/person.service.ts`：
```ts
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { PersonCreateInput, PersonListResponse, PersonPatchInput, PersonResponse } from '@moment/dto';
import { BadRequestError, HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { chainMembers, momentPersons, persons, type Person } from '../db/schema.js';

/** 名归一化（spec §2）：trim + 去内部连续空白（折叠为单空格）；应用层实现，不写 DB 函数。 */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function toResponse(row: Person): PersonResponse {
  return { id: row.id, name: row.name, userId: row.userId };
}

@Service()
export class PersonService {
  /** 编辑器选择器数据源（spec §6 GET）：按 name 升序；词典行无 source/momentCount 概念。 */
  async list(chainId: string): Promise<PersonListResponse> {
    const rows = await db
      .select({ id: persons.id, name: persons.name, userId: persons.userId })
      .from(persons)
      .where(eq(persons.chainId, chainId))
      .orderBy(asc(persons.name));
    return { persons: rows };
  }

  /**
   * 幂等创建（spec §6 POST）：名归一化后撞 uk_persons_chain_name → 返回已存在行
   * （created=false → HTTP 200），不报错、不更新已存在行的 user_id（编辑器「自由文本
   * 新建」天然幂等）。并发兜底：两个请求同时穿过前置查询，后到者撞 ER_DUP_ENTRY 重查返回。
   */
  async create(chainId: string, input: PersonCreateInput): Promise<{ person: PersonResponse; created: boolean }> {
    const name = normalizePersonName(input.name);
    // userId 语义是「链接到链成员用户」（spec §2）——非成员 id 直接拒（见计划偏差 4）
    if (input.userId !== undefined) {
      const [member] = await db
        .select({ userId: chainMembers.userId })
        .from(chainMembers)
        .where(and(eq(chainMembers.chainId, chainId), eq(chainMembers.userId, input.userId)))
        .limit(1);
      if (!member) throw new BadRequestError('PERSON_USER_NOT_IN_CHAIN');
    }

    const [existing] = await db
      .select()
      .from(persons)
      .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
      .limit(1);
    if (existing) return { person: toResponse(existing), created: false };

    const row: Person = { id: randomUUID(), chainId, name, userId: input.userId ?? null, createdAt: new Date() };
    try {
      await db.insert(persons).values(row);
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        const [race] = await db
          .select()
          .from(persons)
          .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
          .limit(1);
        if (race) return { person: toResponse(race), created: false };
      }
      throw err;
    }
    return { person: toResponse(row), created: true };
  }

  /** 改名（spec §6 PATCH）：撞名归一化 → 409 PERSON_NAME_CONFLICT；归一化后同名幂等返回。 */
  async rename(chainId: string, personId: string, input: PersonPatchInput): Promise<PersonResponse> {
    const name = normalizePersonName(input.name);
    const [person] = await db
      .select()
      .from(persons)
      .where(and(eq(persons.id, personId), eq(persons.chainId, chainId)))
      .limit(1);
    if (!person) throw new NotFoundError('PERSON_NOT_FOUND');
    if (person.name === name) return toResponse(person);

    const [dup] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.chainId, chainId), eq(persons.name, name)))
      .limit(1);
    if (dup && dup.id !== personId) throw new HttpError(409, 'PERSON_NAME_CONFLICT');

    try {
      await db.update(persons).set({ name }).where(eq(persons.id, personId));
    } catch (err) {
      // 并发兜底：rename 与 create 同时撞 uk
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'PERSON_NAME_CONFLICT');
      throw err;
    }
    return { id: person.id, name, userId: person.userId };
  }

  /** 删除（spec §6 DELETE）：先删全部 moment_persons 关联再删词典行（元数据级联，不触时刻本体），一个事务。 */
  async remove(chainId: string, personId: string): Promise<void> {
    const [person] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.id, personId), eq(persons.chainId, chainId)))
      .limit(1);
    if (!person) throw new NotFoundError('PERSON_NOT_FOUND');

    await db.transaction(async (tx) => {
      await tx.delete(momentPersons).where(eq(momentPersons.personId, personId));
      await tx.delete(persons).where(eq(persons.id, personId));
    });
  }
}
```

- [ ] **Step 4: 实现 person.controller.ts**

Create `apps/server/src/persons/person.controller.ts`：
```ts
import { personCreateInputSchema, personPatchInputSchema, type PersonListResponse, type PersonResponse } from '@moment/dto';
import type { Response } from 'express';
import {
  Authorized,
  Body,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Params,
  Patch,
  Post,
  Res,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js'; // 0.11 中 @UseBefore 先于 @Authorized 执行（同 tag.controller.ts）
import { PersonService } from './person.service.js';

@JsonController()
@Service()
export class PersonController {
  constructor(private personService: PersonService) {}

  @Get('/chains/:chainId/persons')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(@Params() params: { chainId: string }): Promise<PersonListResponse> {
    return this.personService.list(params.chainId);
  }

  /**
   * 幂等创建（spec §6）：新建 201；名归一化撞 uk_persons_chain_name 返回已存在行 200。
   * 不用 @HttpCode 装饰器——它会在 routing-controllers 的 success handler 里无条件覆盖
   * 状态码；这里经 @Res 手动 set（无 @HttpCode 时框架不再改状态，返回值仍由框架
   * response.json() 发送，见 ExpressDriver.handleSuccess 源码行为，已在计划偏差 3 核实）。
   */
  @Post('/chains/:chainId/persons')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  async create(
    @Params() params: { chainId: string },
    @Body() body: unknown,
    @Res() res: Response
  ): Promise<PersonResponse> {
    const { person, created } = await this.personService.create(
      params.chainId,
      personCreateInputSchema.parse(body)
    );
    res.status(created ? 201 : 200);
    return person;
  }

  @Patch('/chains/:chainId/persons/:personId')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  rename(
    @Params() params: { chainId: string; personId: string },
    @Body() body: unknown
  ): Promise<PersonResponse> {
    return this.personService.rename(params.chainId, params.personId, personPatchInputSchema.parse(body));
  }

  @Delete('/chains/:chainId/persons/:personId')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('editor'))
  remove(@Params() params: { chainId: string; personId: string }): Promise<void> {
    return this.personService.remove(params.chainId, params.personId);
  }
}
```

- [ ] **Step 5: 注册控制器**

Modify `apps/server/src/app.ts` — import 区（`TagController` import 之后）追加：
```ts
import { PersonController } from './persons/person.controller.js';
```
`useExpressServer` 的 `controllers: [...]` 数组中 `TagController` 之后插入 `PersonController`。

- [ ] **Step 6: 链删除 tx 补两行**

Modify `apps/server/src/chains/chain.service.ts`：

schema import 行（现含 `chainInvites, chainMembers, chains, comments, media, momentTags, moments, reactions, shareLinks, tags, users, ...`）在 `momentTags,` 之后、`moments,` 之前插 `momentPersons,`；在 `moments,` 之后（`notifications` 不在此行则按字母序落在 `moments,` 与下一项之间）插 `persons,`。修改后：
```ts
import { chainInvites, chainMembers, chains, comments, media, momentPersons, momentTags, moments, persons, reactions, shareLinks, tags, users, type Chain, type ChainInvite } from '../db/schema.js';
```
`remove()` 的 doc 注释第一行改为：
```ts
   * owner 删链：同事务硬删 reactions → comments → moment_tags → moment_persons → tags → persons → media → moments → invites → members → chain。
```
delete 序列中，`await tx.delete(momentTags).where(inArray(momentTags.momentId, chainMomentIds));` 之后、`await tx.delete(tags).where(eq(tags.chainId, chainId));` 之前插一行；`await tx.delete(tags)...` 之后、`await tx.delete(media)...` 之前插一行：
```ts
      await tx.delete(momentTags).where(inArray(momentTags.momentId, chainMomentIds));
      await tx.delete(momentPersons).where(inArray(momentPersons.momentId, chainMomentIds));
      await tx.delete(tags).where(eq(tags.chainId, chainId));
      await tx.delete(persons).where(eq(persons.chainId, chainId));
```
（`moment_persons` 依赖 moments 与 persons、`persons` 依赖 chains，二者都必须早于 `moments`/`chains` 的 delete——镜像 tags 的兄弟位即满足外键逆序。）

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/persons/persons.test.ts`
Expected: PASS，全部用例过。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 8: 回归 + lint**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: 全套件绿（链删除用例对既有 chains 测试无回归——delete 序列仅新增两表清理）。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/persons/person.controller.ts apps/server/src/persons/person.service.ts apps/server/src/app.ts \
  apps/server/src/chains/chain.service.ts apps/server/tests/persons/persons.test.ts
git commit -m "feat(server): add persons dictionary CRUD with chain-delete cleanup"
```

---

### Task 3: moments create/update 集成（personIds 全量替换 + place 赋值表 + geocode outbox）

**Files:**
- Create: `apps/server/src/persons/replace-moment-persons.ts`
- Create: `apps/server/src/moments/moment-place.ts`
- Modify: `apps/server/src/moments/moment.service.ts`（create/update 集成）
- Modify: `apps/server/src/outbox/types.ts`（`OUTBOX_MOMENT_GEOCODE`）
- Create: `apps/server/tests/moments/moment-persons-place.test.ts`

**Interfaces:**
- Consumes（P1 Produces 逐字引用）:
  - `@moment/dto`：`momentPersonIdsSchema` / `MomentPersonIds`（uuid max 20）、`placeInputSchema` / `PlaceInput`（`{name?, lat?, lng?}` strict + refine）、`MomentPersonSource`（`'manual' | 'ai'`）、`PlaceSource`（`'manual' | 'exif' | 'ai'`）、`CreateMomentInput`（P1 起含 `personIds?: string[]`、`place?: PlaceInput | null`）、`PatchMomentInput`（同上，PATCH 语义）
  - server：`persons` / `momentPersons`（`src/db/schema.js`）、`Moment` 行含 `placeLat/placeLng/placeName/placeSource`、`emitOutbox(tx: DbTx, type: OutboxType, payload: object): Promise<void>`（`src/outbox/outbox.js`）、`OutboxType`（`src/outbox/types.ts`）
  - Task 1 Produces：`serializeMoments(rows, viewerId, { includePrivate: true })`（响应回读 persons/place）
  - Task 2 Produces：`persons` 表属链校验范式（本 Task 在 `replace-moment-persons.ts` 内联实现，同 `replace-moment-tags.ts` 的 `TAG_NOT_IN_CHAIN` 范式）
- Produces（P3–P7 依赖）:
  - `replaceMomentPersons(tx: DbTx, momentId: string, chainId: string, personIds: string[], source?: 'manual' | 'ai'): Promise<void>`（默认 `'manual'`；事务内先删后插全量替换，属链校验失败抛 `BadRequestError('PERSON_NOT_IN_CHAIN')` 并回滚整个业务事务。P4 AI 抽取如需「仅补缺」语义另写助手，不得改本函数签名）
  - `placeColumnsOf(place: PlaceInput | null | undefined): PlaceColumns` 与 `interface PlaceColumns { placeLat: number | null; placeLng: number | null; placeName: string | null; placeSource: PlaceSource | null }`（spec §6 赋值表唯一实现）
  - `isGeocodePending(c: PlaceColumns): c is PlaceColumns & { placeLat: number; placeLng: number; placeSource: 'exif' }`（type guard：仅坐标且 place_name 空）
  - `OUTBOX_MOMENT_GEOCODE = 'moment.geocode'`（`src/outbox/types.ts`；`OutboxType` 联合新增成员）——**P3 geocode worker 消费**；payload 形状 `{ momentId: string; lat: number; lng: number }`（camelCase，见计划偏差 1）
  - API 行为：`POST /api/chains/:chainId/moments` 与 `PATCH /api/moments/:id` 接受 `personIds` / `place`（P5/P6 消费）

**边界（编排硬约束）**：本 Task **不做** `moment.extract` outbox 发射与 `ai_extract_hash` 任何读写——那是 P4 的范围（spec §5 的 hash 判据）。create/update 只新增 `moment.geocode` 一条发射路径。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/moments/moment-persons-place.test.ts`：
```ts
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { momentPersons, moments, outbox } from '../../src/db/schema.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, attachPerson, createChain, insertMoment, insertPerson, registerUser } from '../helpers/fixtures.js';

beforeEach(resetDb);
afterAll(closeDb);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const baseBody = {
  type: 'text' as const,
  content: '在外婆家吃饭',
  happenedAt: '2026-08-20T10:00:00+08:00',
  happenedTzOffset: -480,
};

async function geocodeEvents() {
  return db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
}

async function momentRow(momentId: string) {
  const [row] = await db.select().from(moments).where(eq(moments.id, momentId));
  return row;
}

async function linkRows(momentId: string) {
  return db.select().from(momentPersons).where(eq(momentPersons.momentId, momentId));
}

describe('POST /api/chains/:chainId/moments — personIds（spec §6）', () => {
  it('全部属链 → 写 moment_persons source=manual（重复 id 去重），响应 persons 回读', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const p1 = await insertPerson({ chainId, name: '外婆' });
    const p2 = await insertPerson({ chainId, name: '朵朵' });

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, personIds: [p2, p1, p2] });
    expect(res.status).toBe(201);
    // serializer 按 (momentId, personId) 升序输出；p1/p2 是 randomUUID，先后不定——
    // 排序后比对 id 集合，字段逐元素断言不依赖顺序
    expect(res.body.persons.map((p: { id: string }) => p.id).sort()).toEqual([p1, p2].sort());
    const byId = new Map(res.body.persons.map((p: { id: string }) => [p.id, p]));
    expect(byId.get(p1)).toEqual({ id: p1, name: '外婆', userId: null, source: 'manual' });
    expect(byId.get(p2)).toEqual({ id: p2, name: '朵朵', userId: null, source: 'manual' });
    const links = await linkRows(res.body.id);
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.source === 'manual')).toBe(true);
  });

  it('含他链 person → 400 PERSON_NOT_IN_CHAIN，事务回滚（moment 不落库）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(owner.id, '他链');
    const mine = await insertPerson({ chainId, name: '外婆' });
    const foreign = await insertPerson({ chainId: otherChain, name: '外人' });

    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, personIds: [mine, foreign] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PERSON_NOT_IN_CHAIN');
    expect(await db.select().from(moments).where(eq(moments.chainId, chainId))).toHaveLength(0);
    expect(await db.select().from(momentPersons)).toHaveLength(0);
  });

  it('不传 personIds → 无关联行，响应 persons=[]、place=null', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody });
    expect(res.status).toBe(201);
    expect(await linkRows(res.body.id)).toHaveLength(0);
    expect(res.body.persons).toEqual([]);
    expect(res.body.place).toBeNull();
  });
});

describe('POST — place 赋值表（spec §6，逐行）', () => {
  it('坐标 + 名字 → manual，不触发 geocode', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家', lat: 39.9, lng: 116.4 } });
    expect(res.status).toBe(201);
    expect(res.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' });
    const row = await momentRow(res.body.id);
    expect(row.placeSource).toBe('manual');
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('仅坐标 → exif，同事务写 outbox moment.geocode（payload {momentId, lat, lng}）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 39.9042, lng: 116.4074 } });
    expect(res.status).toBe(201);
    expect(res.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
    const events = await geocodeEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'moment.geocode', status: 'pending' });
    expect(events[0].payload).toEqual({ momentId: res.body.id, lat: 39.9042, lng: 116.4074 });
  });

  it('仅名字 → manual，无坐标、不触发 geocode', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家' } });
    expect(res.status).toBe(201);
    expect(res.body.place).toEqual({ lat: null, lng: null, name: '外婆家', source: 'manual' });
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('place:null 等价未传（P1 偏差 4）：place null、无 outbox', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: null });
    expect(res.status).toBe(201);
    expect(res.body.place).toBeNull();
    const row = await momentRow(res.body.id);
    expect(row.placeSource).toBeNull();
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('坐标越界（lat 91）→ 400（spec §9 server 级复验 dto 的范围校验）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const res = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 91, lng: 0 } });
    expect(res.status).toBe(400);
    // server 全局错误处理把 ZodError 统一映射为 VALIDATION_ERROR（middlewares/error-handler.ts，
    // 同本套件空名用例）；范围校验由 dto 的 zod min/max（lat ∈ [-90,90]）拒绝，
    // PLACE_COORDS_INVALID 只是「同有同无/至少其一」refine 的 message，不作为 HTTP code 出现
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /api/moments/:id — personIds 全量替换（spec §6）', () => {
  it('提交集合写 manual、集合外 manual/ai 一并删；ai 行被重选后升级 manual（spec §5 冲突规则）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    const b = await insertPerson({ chainId, name: '朵朵' });
    await attachPerson(momentId, a, 'manual');
    await attachPerson(momentId, b, 'ai');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ personIds: [b] });
    expect(res.status).toBe(200);
    expect(res.body.persons).toEqual([{ id: b, name: '朵朵', userId: null, source: 'manual' }]);
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ personId: b, source: 'manual' });
  });

  it('空数组 = 清空全部人物', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, a, 'manual');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ personIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.persons).toEqual([]);
    expect(await linkRows(momentId)).toHaveLength(0);
  });

  it('缺省 undefined = 不变（ai 行保留、不因保存被升级——dirty tracking 的 server 侧语义）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    await attachPerson(momentId, a, 'ai');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ content: '只改正文' });
    expect(res.status).toBe(200);
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ personId: a, source: 'ai' });
  });

  it('含他链 person → 400 PERSON_NOT_IN_CHAIN，原关联保留（回滚）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const otherChain = await createChain(owner.id, '他链');
    const momentId = await insertMoment({ chainId, authorId: owner.id, happenedAt: new Date() });
    const a = await insertPerson({ chainId, name: '外婆' });
    const foreign = await insertPerson({ chainId: otherChain, name: '外人' });
    await attachPerson(momentId, a, 'manual');

    const res = await request(app)
      .patch(`/api/moments/${momentId}`)
      .set(auth(owner.token))
      .send({ personIds: [foreign] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PERSON_NOT_IN_CHAIN');
    const links = await linkRows(momentId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ personId: a, source: 'manual' });
  });
});

describe('PATCH — place（spec §6 赋值表 + 清除语义）', () => {
  it('place:null 显式清除三列 + source（spec §5 冲突规则：显式清除 > 一切）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家', lat: 39.9, lng: 116.4 } });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: null });
    expect(res.status).toBe(200);
    expect(res.body.place).toBeNull();
    const row = await momentRow(created.body.id);
    expect(row.placeLat).toBeNull();
    expect(row.placeLng).toBeNull();
    expect(row.placeName).toBeNull();
    expect(row.placeSource).toBeNull();
  });

  it('仅坐标 → exif，同事务写 geocode outbox（manual 文本 place 被整体覆盖）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { name: '外婆家' } });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: { lat: 39.9042, lng: 116.4074 } });
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ lat: 39.9042, lng: 116.4074, name: null, source: 'exif' });
    const events = await geocodeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ momentId: created.body.id, lat: 39.9042, lng: 116.4074 });
  });

  it('仅名字 → manual，坐标清空（三列同生同灭）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 39.9042, lng: 116.4074 } });
    expect(created.status).toBe(201);
    expect(await geocodeEvents()).toHaveLength(1);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: { name: '外婆家' } });
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ lat: null, lng: null, name: '外婆家', source: 'manual' });
    // 手动文本不触发 geocode（spec §4）
    expect(await geocodeEvents()).toHaveLength(1);
  });

  it('坐标 + 名字 → manual，不触发 geocode', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ place: { name: '北京', lat: 39.9, lng: 116.4 } });
    expect(res.status).toBe(200);
    expect(res.body.place).toEqual({ lat: 39.9, lng: 116.4, name: '北京', source: 'manual' });
    expect(await geocodeEvents()).toHaveLength(0);
  });

  it('缺省 undefined = 不变（exif 值保留，不重复发 geocode）', async () => {
    const owner = await registerUser();
    const chainId = await createChain(owner.id);
    const created = await request(app)
      .post(`/api/chains/${chainId}/moments`)
      .set(auth(owner.token))
      .send({ ...baseBody, place: { lat: 39.9042, lng: 116.4074 } });
    expect(created.status).toBe(201);
    expect(await geocodeEvents()).toHaveLength(1);

    const res = await request(app)
      .patch(`/api/moments/${created.body.id}`)
      .set(auth(owner.token))
      .send({ content: '只改正文' });
    expect(res.status).toBe(200);
    const row = await momentRow(created.body.id);
    expect(row.placeSource).toBe('exif');
    expect(row.placeLat).toBeCloseTo(39.9042, 4);
    expect(await geocodeEvents()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-persons-place.test.ts`
Expected: FAIL——POST 带 `personIds` 的响应 `persons` 为 `[]`（未写关联）、`place` 恒 null、`PERSON_NOT_IN_CHAIN` 不会出现（400 之外的 201），PATCH 替换/geocode outbox 全红。

- [ ] **Step 3: 实现 replace-moment-persons.ts**

Create `apps/server/src/persons/replace-moment-persons.ts`：
```ts
import { and, eq, inArray } from 'drizzle-orm';
import { BadRequestError } from 'routing-controllers';
import { momentPersons, persons } from '../db/schema.js';
import type { DbTx } from '../outbox/outbox.js';

/**
 * 在调用方业务事务内全量重建 moment_persons（先删后插，镜像 tags/replace-moment-tags.ts）。
 * - 校验所有 person 均属于 chainId，否则抛 PERSON_NOT_IN_CHAIN，由事务回滚整笔操作。
 * - 全量替换语义（spec §6 PATCH）：提交集合写 source（默认 manual），集合外原有行
 *   （manual 与 ai 一并）删除；ai 行被用户重选后经此路径升级 manual（spec §5 冲突规则）。
 * - 空数组 = 清空全部关联。
 * P4 的 AI「仅补缺」语义不得复用本函数（本函数删全集），需另写助手。
 */
export async function replaceMomentPersons(
  tx: DbTx,
  momentId: string,
  chainId: string,
  personIds: string[],
  source: 'manual' | 'ai' = 'manual',
): Promise<void> {
  await tx.delete(momentPersons).where(eq(momentPersons.momentId, momentId));
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return;

  const found = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(and(inArray(persons.id, unique), eq(persons.chainId, chainId)));
  if (found.length !== unique.length) {
    throw new BadRequestError('PERSON_NOT_IN_CHAIN');
  }

  await tx.insert(momentPersons).values(unique.map((personId) => ({ momentId, personId, source })));
}
```

- [ ] **Step 4: 实现 moment-place.ts**

Create `apps/server/src/moments/moment-place.ts`：
```ts
import type { PlaceInput, PlaceSource } from '@moment/dto';

/** moments 表 place 四列的写值形状（spec §2：三值列 + source 同生同灭） */
export interface PlaceColumns {
  placeLat: number | null;
  placeLng: number | null;
  placeName: string | null;
  placeSource: PlaceSource | null;
}

/**
 * place 赋值表（spec §6，source 只能 server 判定，客户端不传 source）：
 * - 坐标 + 名字 → manual（客户端地图选点/确认后的形态），不触发 geocode
 * - 仅坐标     → exif（EXIF 路），place_name 留空待 worker 回填
 * - 仅名字     → manual（无坐标），不触发 geocode
 * - null/缺省  → 四列全 null（PATCH 上为显式清除；create 上等价未传，P1 偏差 4）
 * 整体覆盖语义：提交 place 即整体覆盖四列（「仅名字」会把既有坐标清掉——三列同生同灭）。
 */
export function placeColumnsOf(place: PlaceInput | null | undefined): PlaceColumns {
  if (!place) return { placeLat: null, placeLng: null, placeName: null, placeSource: null };
  const hasCoords = place.lat !== undefined && place.lng !== undefined;
  if (hasCoords) {
    return {
      placeLat: place.lat as number,
      placeLng: place.lng as number,
      placeName: place.name ?? null,
      placeSource: place.name !== undefined ? 'manual' : 'exif',
    };
  }
  return { placeLat: null, placeLng: null, placeName: place.name ?? null, placeSource: 'manual' };
}

/** geocode 触发判据（spec §4）：仅坐标且 place_name 空（exif 形态）→ 同事务写 moment.geocode */
export function isGeocodePending(
  c: PlaceColumns
): c is PlaceColumns & { placeLat: number; placeLng: number; placeSource: 'exif' } {
  return c.placeSource === 'exif' && c.placeName === null && c.placeLat !== null && c.placeLng !== null;
}
```

- [ ] **Step 5: outbox 类型常量**

Modify `apps/server/src/outbox/types.ts` — 在 `export const OUTBOX_RECAP_GENERATE = 'recap.generate';` 之后追加：
```ts
/** 逆地理编码（spec people-place §4）：payload {momentId, lat, lng}（WGS-84；P2 moments 写路径发射，P3 worker 消费） */
export const OUTBOX_MOMENT_GEOCODE = 'moment.geocode';
```
`OutboxType` 联合在 `| typeof OUTBOX_RECAP_GENERATE` 之后追加 `| typeof OUTBOX_MOMENT_GEOCODE`。

- [ ] **Step 6: moment.service.ts 集成**

Modify `apps/server/src/moments/moment.service.ts`：

import 区追加（`replaceMomentTags` import 行之后）：
```ts
import { replaceMomentPersons } from '../persons/replace-moment-persons.js';
import { isGeocodePending, placeColumnsOf } from './moment-place.js';
```
outbox 常量 import 行替换为（加 `OUTBOX_MOMENT_GEOCODE`）：
```ts
import { OUTBOX_MOMENT_CREATED, OUTBOX_MOMENT_DELETED, OUTBOX_MOMENT_GEOCODE, OUTBOX_MOMENT_TRANSCRIBE } from '../outbox/types.js';
```

**create()**——三处改动：

(a) `const happenedAt = new Date(input.happenedAt);` 之后追加一行：
```ts
    // place 赋值表（spec §6）纯函数预计算；create 上 place:null/缺省等价无地点（P1 偏差 4）
    const placeCols = placeColumnsOf(input.place);
```
(b) `tx.insert(moments).values({...})` 内，`isBackfill: input.isBackfill,` 之后、`...(input.type === 'voice' ...)` spread 之前追加：
```ts
        ...placeCols,
```
(c) `await replaceMomentTags(tx, inserted.id, chainId, input.tagIds ?? []);` 之后、`await emitOutbox(tx, OUTBOX_MOMENT_CREATED, ...)` 之前追加：
```ts
      await replaceMomentPersons(tx, inserted.id, chainId, input.personIds ?? []);

      // 仅坐标且 place_name 空（exif 形态）→ 同事务写 geocode outbox（spec §4；worker 属 P3）
      if (isGeocodePending(placeCols)) {
        await emitOutbox(tx, OUTBOX_MOMENT_GEOCODE, {
          momentId,
          lat: placeCols.placeLat,
          lng: placeCols.placeLng,
        });
      }
```

**update()**——三处改动：

(a) `const updatedRow = await db.transaction(async (tx) => {` 之前追加一行（在 kindPayloadSet 计算块之后）：
```ts
    // place 整体覆盖（spec §6）：undefined = 不变；null = 清空三列 + source；对象 = 赋值表整体覆盖
    const placeSet = input.place !== undefined ? placeColumnsOf(input.place) : null;
```
(b) `tx.update(moments).set({...})` 内，`...kindPayloadSet,` 之后追加：
```ts
          ...(placeSet ?? {}),
```
(c) `if (input.tagIds !== undefined) { await replaceMomentTags(tx, row.id, row.chainId, input.tagIds); }` 之后、`return row;` 之前追加：
```ts
      if (input.personIds !== undefined) {
        // 全量替换（spec §6）：提交集合写 manual、集合外 manual/ai 一并删；空数组 = 清空
        await replaceMomentPersons(tx, row.id, row.chainId, input.personIds);
      }
      // 显式提交 place 且落在 exif 分支（仅坐标、无名字）→ 同事务写 geocode outbox（spec §4）
      if (placeSet && isGeocodePending(placeSet)) {
        await emitOutbox(tx, OUTBOX_MOMENT_GEOCODE, {
          momentId,
          lat: placeSet.placeLat,
          lng: placeSet.placeLng,
        });
      }
```

（`serializeMoments` 四处调用已在 Task 1 传 `{ includePrivate: true }`——本 Task 响应断言 persons/place 回读依赖它。`moment.extract` 发射与 `ai_extract_hash` 读写属 P4，此处禁做。）

- [ ] **Step 7: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/moments/moment-persons-place.test.ts`
Expected: PASS，全部用例过。

- [ ] **Step 8: 全量回归 + lint**

Run: `pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint`
Expected: 全套件绿无回归（既有 moments/feed/share 测试不受影响：新字段在响应中新增，`toMatchObject` 断言不破；share 路径输出不变——Task 1 红线测试复验）。

- [ ] **Step 9: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/persons/replace-moment-persons.ts apps/server/src/moments/moment-place.ts \
  apps/server/src/moments/moment.service.ts apps/server/src/outbox/types.ts \
  apps/server/tests/moments/moment-persons-place.test.ts
git commit -m "feat(server): integrate personIds and place into moment create/update with geocode outbox"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全套件绿，含新增：`moment-private-serialization.test.ts`（includePrivate 双路红线 5 用例）、`persons.test.ts`（CRUD/幂等/冲突/删除级联/链删除清理）、`moment-persons-place.test.ts`（personIds/place 赋值表逐行 + 坐标范围校验 + PATCH 替换语义 + geocode outbox）
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] `pnpm --filter @moment/dto test` / `build` / `lint` exit 0（persons/place 必填化 + PublicShareMoment 收口）
- [ ] `pnpm --filter @moment/web typecheck` / `test`、`pnpm --filter @moment/app typecheck`、`pnpm --filter @moment/api-client typecheck` / `test` 全绿（dto 收口的编译外溢已修复）
- [ ] spec §6 赋值表逐行覆盖（四行各有 create 测试；PATCH 四形态 + null 清除 + undefined 不变各有测试）
- [ ] spec §5 冲突规则中 P2 负责部分：PATCH 提交集合写 manual、集合外 ai/manual 一并删、ai 行重选升级 manual、ai 行未被操作时不因保存升级（undefined 不变测试）
- [ ] spec §8 红线：share-album 输出零 persons/place 键（`'persons' in m === false` 级断言）；链内路径 persons/place 必产出（含空形态）
- [ ] spec §2 链删除：chain.service 删除 tx 含 `moment_persons`、`persons` 两行 delete，测试钉死
- [ ] 边界确认：无任何 `moment.extract` 发射 / `ai_extract_hash` 读写（P4 范围）；无任何客户端 source 入参
- [ ] Produces 符号逐个可解析：`PersonController` / `PersonService` / `normalizePersonName` / `replaceMomentPersons` / `placeColumnsOf` / `isGeocodePending` / `PlaceColumns` / `OUTBOX_MOMENT_GEOCODE` / `PublicShareMoment` / `serializeMoments` 重载签名

## 写完自查（起草者已执行）

- **spec 覆盖**：§6 Persons 四端点（GET/POST/PATCH/DELETE 含幂等与 409）、§6 moments 增量字段（personIds 校验/替换、place 四分支 + null + undefined）、§6 序列化（批取、PersonBrief/MomentPlace 形状、词典响应 {id,name,userId}）、§8 红线（includePrivate 默认 false + 双路测试）、§9 server 测试清单逐项对应、§2 链删除 tx 两行、§4 geocode 触发时机（仅坐标且 place_name 空时同事务）。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」。
- **跨 Task 类型一致性**：Consumes 符号与 P1 Produces 逐字核对（`momentPersonIdsSchema`/`placeInputSchema`/`PersonBrief`/`MomentPlace`/`PersonResponse`/`PersonListResponse`/`personCreateInputSchema`/`personPatchInputSchema`/`persons`/`momentPersons`/`insertPerson`/`attachPerson`）；Task 1 Produces 的 `serializeMoments` 重载被 Task 3 响应断言消费；`OUTBOX_MOMENT_GEOCODE` payload camelCase 与偏差 1 一致。
