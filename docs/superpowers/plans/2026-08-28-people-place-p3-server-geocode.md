# 时刻人物与地点 P3：geocode 模块（gcj02 + 高德 provider）+ moment.geocode worker 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「时刻人物与地点」的逆地理编码管线（spec §4 全节）：`src/geocode/` 新模块——`gcj02.ts`（WGS-84→GCJ-02 纯函数换算，含中国境外判断）、`base.provider.ts`（`GeocodeProvider` 接口，入参钉死 WGS-84）、`factory.ts`（三态单例 + `setGeocodeProvider` 测试注入，逐字复刻 `llm/factory.ts` 范式）、`amap.provider.ts`（高德 v3 regeo，调前换算 GCJ-02、`location=lng,lat`、取 `regeocode.formatted_address`）；`config.ts` 新增 `AMAP_WEB_KEY`（空 → factory null → 消费即跳过，管线不阻断）；worker 新增 `moment.geocode` handler（重读时刻防软删竞态 → provider null 跳过 → 成功条件回填 `place_name`，仅当 `place_source` 仍为 `exif` 且 `place_name` 为空；失败走 outbox 既有 5 档指数退避，终败仅记日志不重派）。

**Architecture:** provider 层与 LLM/ASR 同范式（接口 + 默认实现 + factory 三态单例 + `setXxxProvider` 测试注入）。坐标红线：DB 恒存 WGS-84 原值，GCJ-02 换算**只**发生在 `AmapProvider.reverse` 内部（接口注释钉死入参 WGS-84），后续地图足迹视图直接复用 `gcj02.ts`。错误语义（本计划定死，见偏差 3）：`null` = 高德明确成功（`status === "1"`）但拿不到非空 `formatted_address`（「确定无结果」）；其余一切失败（网络/超时/HTTP 非 2xx/`status !== "1"`/畸形 JSON）抛 `RetryableLLMError` / `NonRetryableLLMError`（复用 `src/llm/base.provider.ts` 既有错误类，对齐 ASR 的「类名里的 LLM 是历史命名」先例）。handler **不 try/catch**：全部抛出传播给 processor，由既有 `RETRY_DELAYS_MS` 5 档退避驱动，attempts>5 由 processor 记 error 日志并标 failed（即 spec §4 的「终败仅记日志，不重派」——outbox 行自身状态就是唯一记录）。HTTP 层可测性：mock `globalThis.fetch`（对齐 `tests/llm/provider.test.ts` 既有范式），不注入 fetch。

**Tech Stack:** Node ≥20 内置 `fetch` + `AbortController`（超时 10s）/ zod ^3.22（config）/ jest（真实 MySQL 测试库 `--runInBand`；gcj02/config/factory/provider 均为不触库纯单测，仅 handler 测试触库）。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§4 逆地理编码全节、§5 worker 消费软删跳过、§8 隐私（坐标发高德、空 key 停用）、§9 测试策略、§10 容量、§11 P3 出口标准）

**上游契约:** `docs/superpowers/plans/2026-08-28-people-place-p2-server-persons.md`（其 Task 3 Produces 的 `OUTBOX_MOMENT_GEOCODE` 常量与 payload 形状逐字消费）；执行编排 `docs/superpowers/prompts/2026-08-28-people-place-execution.md` T3 节 + §1 M1 专属硬约束（坐标系 / AMAP_WEB_KEY / worker 软删竞态 / outbox 命名）。

## Global Constraints（只写本计划新增，通用约束继承 Phase 1 / 编排 §1）

- **坐标系**（spec §4，编排硬约束）：DB 恒落 WGS-84 原值；调高德 rego 前必须经 `wgs84ToGcj02` 换算（境外不偏移直接请求）；`location` 拼接 **lng 在前**（`location=lng,lat`）。换算只存在于 `amap.provider.ts` 一处，handler 与测试不得重复实现。
- **`AMAP_WEB_KEY`**（spec §4/§8）：经 `config.ts` zod（默认空串）+ `.env.example` 同步（含隐私注释：坐标会发高德）。空 key → `getGeocodeProvider()` 返回 null → outbox 消费即跳过（坐标照存、`place_name` 留空），管线不阻断（同 recap 的 `LLM_API_KEY` 停用模式）。
- **worker 软删竞态**（spec §4/§5，编排硬约束）：`moment.geocode` 消费时重读时刻，不存在或已软删（`deletedAt` 非空）即 done 跳过；回填 UPDATE 再带 `deleted_at IS NULL` 条件（IO 后二次校验，对齐 transcribe 的 CAS 范式）。
- **上游 payload 契约**（P2 偏差 1）：`moment.geocode` payload 为 **camelCase** `{ momentId: string; lat: number; lng: number }`（spec §4 字面 snake_case 已被 P2 修正，本计划以 P2 为准）。`OUTBOX_MOMENT_GEOCODE` 常量已由 P2 Task 3 落地在 `src/outbox/types.ts`，本计划**只消费不改**（见偏差 2）。
- **provider HTTP 层可测性**：对齐 `tests/llm/provider.test.ts` 的 `globalThis.fetch` mock 范式（mock fetch 函数替换 + finally 恢复），不新增注入式 fetch 参数、不新增环境变量之外的全局状态。
- 触库测试打 `.env` 指向的远程共享测试库：`--runInBand`、`afterAll(closeDb)`、`beforeEach(resetDb)`、禁止两个 jest 会话并行（瞬时 ECONNRESET 重跑同一命令即可）；严禁生产库。
- 每 Task 一个 commit（conventional commits）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **payload 消费形状以 P2 为准（继承 P2 偏差 1）**：spec §4 字面写 outbox payload `{moment_id, lat, lng}`（snake_case），但既有全部 outbox payload 均 camelCase，P2 已钉死 `{ momentId, lat, lng }` 且常量 `OUTBOX_MOMENT_GEOCODE` 已随 P2 落地。本计划逐字消费该形状，不再改动（spec 与 P2 的矛盾已由上游裁决，此处只是引用）。
2. **不修改 `src/outbox/types.ts`**：编排 T3 的 owner 清单把 `outbox/types.ts` 列入 Modify，但 P2 计划偏差 2 已把常量先行落地（「常量必须先于发射存在」），本计划只 import/消费（handler 注册表与既有条目一致用字符串字面量 `'moment.geocode'`，实际上连 import 都不需要——`handlers.ts` 现状全部条目均为字面量键）。这是对编排 owner 清单重叠处的边界细化，以 P2 偏差 2 为准，非越界。
3. **provider 错误语义定死（spec 未明说，本计划钉死）**：`reverse` 返回 `null` 表示「高德明确成功（`status === "1"`）但拿不到非空 `formatted_address`」——handler 消费即 done、`place_name` 留空、不重试；**其余一切失败抛错**（网络/超时 → `RetryableLLMError`；HTTP 4xx 非 429、`status !== "1"`、JSON 畸形 → `NonRetryableLLMError`；HTTP 429/5xx → `RetryableLLMError`）。**handler 不 catch、全传播**给 processor → 既有 5 档指数退避 → attempts>5 processor 记 error 日志并标 failed。与 transcribe handler「NonRetryable 自落 failed 终态」不同范式的理由：(a) geocode 没有 moment 上的 geocode 终态列可自落，outbox 行自身状态就是唯一记录，走完 pending→(退避)→failed 才是 spec §4「失败走 outbox 既有指数退避，终败仅记日志」的字面实现；(b) 高德 `status !== "1"` 混杂永久性（INVALID_USER_KEY）与时变性（DAILY_QUERY_OVER_LIMIT 次日重置、CUQPS 限流）错误，`info`/`infocode` 分类不足以可靠区分可恢复性——按 NonRetryable 提前 done 会把「明天配额恢复就能成功」的行静默丢掉；(c) worker 串行消费、失败重试上限 6 次请求，浪费有界。
4. **handler 坐标来源定死：以重读的 moment 行 `placeLat`/`placeLng` 为准，payload 的 `lat`/`lng` 不消费**：spec §4 只说 payload 携带坐标，未说 handler 用哪份。payload 是发射时快照、行值是消费时真相——用户 PATCH 重新绑定新坐标（再次走 exif 分支）会发新 outbox 行，旧事件行晚到时若用旧快照坐标，会把**旧坐标**的地名写到**新坐标**的 place 上。handler 只消费 `payload.momentId`（`lat`/`lng` 仅为排查时的 payload 语义留存）。
5. **`place_name` 截断 255**：worker 回填绕过 API 校验（dto `name` max(255)、列 `varchar(255)`），高德 `formatted_address` 极端超长时截断，不落出 API 写不出的值——对齐 transcribe 的 `TRANSCRIPT_MAX_CHARS = 5000` 范式。
6. **境外判断边界钉死为经典矩形** `[72.004, 137.8347] × [0.8293, 55.8271]`（业内通用实现；经典实现用严格不等式、边界值算境外，本计划用含等号、**边界值算界内（本计划钉死）**；港澳台落在矩形内按境内偏移处理）。spec §4 只写「含中国境外判断」，未定边界。已实测（起草时 node 验证）：境内代表点偏移 dLat ∈ [0.0012, 0.0027]、dLng ∈ [0.0025, 0.0062]（百米级），境外点原值返回。
7. **regeo 端点硬编码常量，不加 `AMAP_BASE_URL` 环境变量**：spec §4 只要求 `AMAP_WEB_KEY` 一个新环境变量；高德 Web 服务端点不是配置面（无自建兼容端点场景，与 LLM 的 OpenAI 兼容多服务商不同）。URL 常量 `AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo'` 导出供测试引用。
8. **超时 10s**（spec 未定）：regeo 是轻量同步接口，对齐 `openai-compat.provider.ts` 的 `AbortController` 范式但取 10s（LLM 生成 60s、ASR 异步任务 300s 均不适用）。构造参数 `timeoutMs` 可覆盖，测试用 100ms。
9. **`location` 小数位 6 位**：`toFixed(6)`（高德 regeo 文档 location 规则：经度,纬度，最多 6 位小数；WGS-84 库存列 decimal(10,7) 换算后第 7 位已无意义）。

---

### Task 1: gcj02.ts 纯函数（WGS-84→GCJ-02 换算 + 境外判断）

**Files:**
- Create: `apps/server/src/geocode/gcj02.ts`
- Test: `apps/server/tests/geocode/gcj02.test.ts`

**Interfaces:**
- Consumes: 无（纯函数、零依赖——spec §4「纯函数无依赖」字面要求）。
- Produces（Task 3 消费；P5+/地图足迹视图复用）:
  - `wgs84ToGcj02(lat: number, lng: number): Gcj02Point`（`apps/server/src/geocode/gcj02.ts`；入参/出参均为度数；境外点原值返回**同一数值**）
  - `interface Gcj02Point { lat: number; lng: number }`（`gcj02.ts` 同文件导出）
  - `outOfChina(lat: number, lng: number): boolean`（经典矩形边界判断，导出供测试钉边界）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/geocode/gcj02.test.ts`（纯单测，不触库，无需 resetDb/closeDb）：
```ts
import { outOfChina, wgs84ToGcj02 } from '../../src/geocode/gcj02.js';

describe('wgs84ToGcj02（spec people-place §4 坐标系：境内偏移、境外不偏移）', () => {
  it('境内已知点（北京）产生百米级偏移：两个方向的偏移量均在 0.0005°..0.02°（约 55m..2.2km）', () => {
    const g = wgs84ToGcj02(39.9042, 116.4074);
    const dLat = Math.abs(g.lat - 39.9042);
    const dLng = Math.abs(g.lng - 116.4074);
    // 实测（标准算法）：北京 dLat≈0.0014、dLng≈0.0062 —— 断言量级带而非精确值
    // （算法输入输出连续光滑，量级带对实现细节稳健；精确回归值无权威参照系）
    expect(dLat).toBeGreaterThan(0.0005);
    expect(dLat).toBeLessThan(0.02);
    expect(dLng).toBeGreaterThan(0.0005);
    expect(dLng).toBeLessThan(0.02);
  });

  it('境内已知点（上海/广州/乌鲁木齐/哈尔滨）偏移量级一致（南北东西全覆盖）', () => {
    const points: Array<[number, number]> = [
      [31.2304, 121.4737], // 上海（dLat 为负——不假设偏移方向）
      [23.1291, 113.2644], // 广州
      [43.8256, 87.6168], // 乌鲁木齐（近西界）
      [45.8038, 126.535], // 哈尔滨（近北界）
    ];
    for (const [lat, lng] of points) {
      const g = wgs84ToGcj02(lat, lng);
      expect(Math.abs(g.lat - lat)).toBeGreaterThan(0.0005);
      expect(Math.abs(g.lat - lat)).toBeLessThan(0.02);
      expect(Math.abs(g.lng - lng)).toBeGreaterThan(0.0005);
      expect(Math.abs(g.lng - lng)).toBeLessThan(0.02);
    }
  });

  it('境外点不偏移：原值返回（东京/纽约，spec §4「境外不偏移直接请求」）', () => {
    expect(wgs84ToGcj02(35.6895, 139.6917)).toEqual({ lat: 35.6895, lng: 139.6917 });
    expect(wgs84ToGcj02(40.7128, -74.006)).toEqual({ lat: 40.7128, lng: -74.006 });
  });

  it('中国区域矩形边界外紧邻点不偏移（北界 55.8271 / 西界 72.004 / 南界 0.8293 之外）', () => {
    expect(wgs84ToGcj02(55.9, 116.4)).toEqual({ lat: 55.9, lng: 116.4 });
    expect(wgs84ToGcj02(39.9, 71.9)).toEqual({ lat: 39.9, lng: 71.9 });
    expect(wgs84ToGcj02(0.5, 110.0)).toEqual({ lat: 0.5, lng: 110.0 });
  });

  it('outOfChina 边界矩形：界内 false、界外 true、边界值按界内（含港澳台按境内，见计划偏差 6）', () => {
    expect(outOfChina(39.9042, 116.4074)).toBe(false); // 北京
    expect(outOfChina(22.3193, 114.1694)).toBe(false); // 香港（矩形内 → 境内处理）
    expect(outOfChina(35.6895, 139.6917)).toBe(true); // 东京
    expect(outOfChina(40.7128, -74.006)).toBe(true); // 纽约
    expect(outOfChina(0.8293, 72.004)).toBe(false); // 边界值在界内
    expect(outOfChina(55.8271, 137.8347)).toBe(false);
    expect(outOfChina(0.8292, 72.004)).toBe(true); // 略出南界
    expect(outOfChina(55.8272, 137.8347)).toBe(true); // 略出北界
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/geocode/gcj02.test.ts`
Expected: FAIL，`Cannot find module '../../src/geocode/gcj02.js'`。

- [ ] **Step 3: 实现 gcj02.ts**

Create `apps/server/src/geocode/gcj02.ts`：
```ts
/**
 * WGS-84 → GCJ-02 坐标换算（spec people-place §4）。
 *
 * 高德全家（regeo / 地图 SDK）使用 GCJ-02（俗称火星坐标系）；EXIF GPS 与手动地图选点
 * 均为 WGS-84。DB 恒存 WGS-84 原值（数据真相），仅在调用高德前做本换算；
 * 后续「地图足迹」展示同样复用本模块。
 *
 * 纯函数、零依赖；标准偏移算法（克拉索夫斯基椭球 + 多项式扰动），
 * 与业界通用实现（eviltransform 等）逐项一致。
 * 境外判断用经典矩形边界（见 outOfChina）；境外点原值返回，不偏移
 * （高德对境外坐标按 WGS-84 语义应答，spec §4「境外不偏移直接请求」）。
 */

/** 克拉索夫斯基椭球长半轴（米），GCJ-02 偏移计算的基准椭球 */
const SEMI_MAJOR_AXIS = 6378245.0;
/** 第一偏心率平方（克拉索夫斯基椭球） */
const ECCENTRICITY_SQ = 0.00669342162296594323;

/** 换算结果点（度数） */
export interface Gcj02Point {
  lat: number;
  lng: number;
}

/**
 * 中国境外判断：经典矩形边界（业内通用实现；经典实现用严格不等式、边界值算境外，
 * 本计划用含等号、边界值算界内——本计划钉死，见计划偏差 6）。
 * 港澳台落在矩形内 → 按境内偏移处理。边界值本身算界内。
 */
export function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02（度数）。境内点偏移百米级（实测 dLat≈0.001..0.003、dLng≈0.003..0.006）；
 * 境外点原值返回（lat/lng 数值不变）。
 */
export function wgs84ToGcj02(lat: number, lng: number): Gcj02Point {
  if (outOfChina(lat, lng)) return { lat, lng };

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ECCENTRICITY_SQ * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQ)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/geocode/gcj02.test.ts`
Expected: PASS，5 个用例全过。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/geocode/gcj02.ts apps/server/tests/geocode/gcj02.test.ts
git commit -m "feat(server): add wgs84-to-gcj02 coordinate conversion pure function"
```

---

### Task 2: config AMAP_WEB_KEY + .env.example 同步

**Files:**
- Modify: `apps/server/src/config.ts`（`AMAP_WEB_KEY` zod 字段）
- Modify: `apps/server/.env.example`（同步 + 隐私注释）
- Test: `apps/server/tests/geocode/config.test.ts`

**Interfaces:**
- Consumes: 既有 `envSchema` / `config`（`src/config.ts`，`export const envSchema` 已导出，供测试边界校验复用真实 schema 本体）。
- Produces: `config.AMAP_WEB_KEY: string`（默认 `''`；Task 3 factory 消费——空串即停用开关；P7 e2e 的停用场景消费）。

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/geocode/config.test.ts`（纯单测，不触库）：
```ts
import { config, envSchema } from '../../src/config.js';

describe('config AMAP_WEB_KEY（spec people-place §4）', () => {
  // 与 tests/llm/config.test.ts 的 LLM_API_KEY 断言同款前提：测试库 .env 未配置 AMAP_WEB_KEY
  // （字段为 P3 新增，.env.example 默认留空）。若未来测试 .env 配置了真实 key，此断言需同步调整。
  it('默认空串（未配置 = geocode 停用）', () => {
    expect(config.AMAP_WEB_KEY).toBe('');
  });

  it('envSchema 接受任意非空字符串 key', () => {
    const cfg = envSchema.parse({ ...process.env, AMAP_WEB_KEY: 'amap-test-key-32bytes' });
    expect(cfg.AMAP_WEB_KEY).toBe('amap-test-key-32bytes');
  });

  it('缺省（undefined）回落空串', () => {
    const cfg = envSchema.parse({ ...process.env, AMAP_WEB_KEY: undefined });
    expect(cfg.AMAP_WEB_KEY).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/geocode/config.test.ts`
Expected: FAIL——`config.AMAP_WEB_KEY` 访问不存在的属性 → TS 编译错误（`Property 'AMAP_WEB_KEY' does not exist`）或运行时 `undefined !== ''` 断言失败。

- [ ] **Step 3: 修改 config.ts**

Modify `apps/server/src/config.ts` — 在 `ASR_MODEL: z.string().default('fun-asr'),` 之后、闭合 `})` 之前追加：
```ts
  // ---------- 逆地理编码 geocode（spec people-place §4；高德 Web 服务 v3 regeo） ----------
  // 高德 Web 服务 key；空串 = geocode 停用（坐标照存、place_name 留空、outbox 消费即跳过，spec §4/§8）。
  // 隐私：配置后 worker 会把时刻坐标（GCJ-02 换算后）发送到高德（spec §8）。
  AMAP_WEB_KEY: z.string().default(''),
```

- [ ] **Step 4: 同步 .env.example**

Modify `apps/server/.env.example` — 在 `ASR_MODEL=fun-asr` 行之后、`# 备份 sidecar` 注释之前追加：
```env

# ---------- 逆地理编码 geocode（与 LLM_*/ASR_* 独立，可单独停用） ----------
# 高德 Web 服务 key（restapi.amap.com）。真实值仅放 ignored 的本地 env / 部署 secret。
# 隐私注意：配置后 worker 会把时刻坐标（WGS-84→GCJ-02 换算后）发送到高德做逆地理编码（spec §8）；
# 留空 = 停用（坐标照常落库，仅缺地名回填）
AMAP_WEB_KEY=
```

- [ ] **Step 5: 运行确认通过**

Run:
```bash
pnpm --filter @moment/server test -- tests/geocode/config.test.ts
pnpm --filter @moment/server typecheck
```
Expected: 测试 PASS（3 个 it）；typecheck exit 0（`config` 类型含新字段）。config 新增字段有默认值，缺失 env 不报错——既有测试无回归（Task 4 末尾统一跑全量）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/config.ts apps/server/.env.example apps/server/tests/geocode/config.test.ts
git commit -m "feat(server): add AMAP_WEB_KEY config with privacy-noted env example"
```

---

### Task 3: geocode provider 模块（接口 + 高德实现 + factory 三态单例）

**Files:**
- Create: `apps/server/src/geocode/base.provider.ts`
- Create: `apps/server/src/geocode/amap.provider.ts`
- Create: `apps/server/src/geocode/factory.ts`
- Test: `apps/server/tests/geocode/amap-provider.test.ts`
- Test: `apps/server/tests/geocode/factory.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 Produces：`wgs84ToGcj02(lat: number, lng: number): Gcj02Point`（`./gcj02.js`）
  - Task 2 Produces：`config.AMAP_WEB_KEY: string`
  - 既有：`RetryableLLMError` / `NonRetryableLLMError`（`src/llm/base.provider.js`，错误分类语义与 outbox 退避契约一致——类名里的 LLM 是历史命名，对齐 `llm/asr/base.provider.ts` 的再导出注释先例）；Node 内置 `globalThis.fetch` / `AbortController`
- Produces（Task 4 消费；P4/P7 复用范式；P5+ 地图足迹复用 gcj02）:
  - `interface GeocodeProvider { reverse(lat: number, lng: number): Promise<string | null> }`（`base.provider.ts`；**入参 WGS-84**，接口注释钉死；返回 `null` = 确定无地址，抛错 = 本次尝试失败）
  - `class AmapProvider implements GeocodeProvider`（构造注入 `AmapProviderOptions = { apiKey: string; timeoutMs?: number }`，timeout 默认 10s）
  - `AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo'`（`amap.provider.ts` 导出常量）
  - `getGeocodeProvider(): GeocodeProvider | null`（factory 三态单例；`AMAP_WEB_KEY` 空 → null）
  - `setGeocodeProvider(p: GeocodeProvider | null | undefined): void`（测试注入点；`undefined` 重置回真实 config 行为；严禁业务代码使用）

- [ ] **Step 1: 写失败测试 — amap provider（mock globalThis.fetch）**

Create `apps/server/tests/geocode/amap-provider.test.ts`（纯单测，不触库，对齐 `tests/llm/provider.test.ts` 的 mock fetch 范式）：
```ts
import { AmapProvider } from '../../src/geocode/amap.provider.js';
import { wgs84ToGcj02 } from '../../src/geocode/gcj02.js';
import { NonRetryableLLMError, RetryableLLMError } from '../../src/llm/base.provider.js';

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

/** mock fetch 永不 resolve（模拟超时）。
 * 真实 fetch 会在 signal abort 时 reject 一个 name='AbortError' 的错误；mock 须模拟此行为，
 * 否则 provider 的 AbortController 超时无法触发 fetch reject（测试会挂到 jest 超时）。 */
function mockFetchHang(): typeof fetch {
  return ((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        },
        { once: true },
      );
    })) as typeof fetch;
}

const baseOpts = { apiKey: 'amap-test-key' };

describe('AmapProvider.reverse — 成功路径', () => {
  it('解析 regeocode.formatted_address；URL 携带 key 与 GCJ-02 location（lng 在前、6 位小数，spec §4）', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({
          status: '1',
          info: 'OK',
          infocode: '10000',
          regeocode: { formatted_address: '北京市东城区东华门街道天安门广场' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new AmapProvider(baseOpts);
      const address = await provider.reverse(39.9042, 116.4074);
      expect(address).toBe('北京市东城区东华门街道天安门广场');

      const u = new URL(capturedUrl!);
      expect(u.origin + u.pathname).toBe('https://restapi.amap.com/v3/geocode/regeo');
      expect(u.searchParams.get('key')).toBe('amap-test-key');
      // location：先 WGS-84→GCJ-02，再 lng,lat 顺序拼接（spec §4，计划偏差 9）
      const gcj = wgs84ToGcj02(39.9042, 116.4074);
      expect(u.searchParams.get('location')).toBe(`${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('境外坐标不换算：location 用原值（东京，spec §4「境外不偏移直接请求」）', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(
        JSON.stringify({ status: '1', regeocode: { formatted_address: '東京都千代田区' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const provider = new AmapProvider(baseOpts);
      const address = await provider.reverse(35.6895, 139.6917);
      expect(address).toBe('東京都千代田区');
      expect(new URL(capturedUrl!).searchParams.get('location')).toBe('139.691700,35.689500');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('status=1 但 formatted_address 缺失/为空 → 返回 null（确定无地址，不重试）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { status: '1', regeocode: {} });
    try {
      const provider = new AmapProvider(baseOpts);
      expect(await provider.reverse(39.9042, 116.4074)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = mockFetch(200, { status: '1', regeocode: { formatted_address: '' } });
    try {
      const provider = new AmapProvider(baseOpts);
      expect(await provider.reverse(39.9042, 116.4074)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('AmapProvider.reverse — 错误分类（计划偏差 3）', () => {
  it('amap status !== "1"（如 INVALID_USER_KEY）→ NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(200, { status: '0', info: 'INVALID_USER_KEY', infocode: '10001' });
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toMatchObject({
        name: 'NonRetryableLLMError',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 500 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(500, {});
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 429 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(429, {});
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('HTTP 403 → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(403, {});
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('网络错误 → RetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchNetworkError();
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('超时 → RetryableLLMError（默认 10s，测试用 100ms，计划偏差 8）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchHang();
    try {
      const provider = new AmapProvider({ apiKey: 'amap-test-key', timeoutMs: 100 });
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(RetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('2xx 但响应体非 JSON → NonRetryableLLMError', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('<html>gateway error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch;
    try {
      const provider = new AmapProvider(baseOpts);
      await expect(provider.reverse(39.9042, 116.4074)).rejects.toBeInstanceOf(NonRetryableLLMError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/geocode/amap-provider.test.ts`
Expected: FAIL，`Cannot find module '../../src/geocode/amap.provider.js'`。

- [ ] **Step 3: 实现 base.provider.ts**

Create `apps/server/src/geocode/base.provider.ts`：
```ts
/**
 * Geocode Provider 接口（spec people-place §4）。
 * 与 LLMProvider / ASRProvider 同范式：接口 + 默认实现 + factory 单例 + 测试注入点。
 * 错误分类复用 ../llm/base.provider.js 的 RetryableLLMError / NonRetryableLLMError——
 * 分类语义与 outbox 退避契约一致（429/5xx/网络/超时 vs 其他 4xx），类名里的 LLM 是历史命名
 * （先例：llm/asr/base.provider.ts）。
 */
export interface GeocodeProvider {
  /**
   * 逆地理编码：坐标 → 地名。
   * 入参为 **WGS-84**（DB 落库原值坐标系；GCJ-02 换算是 provider 内部实现细节，
   * 调用方不得预先换算——spec §4 坐标系红线）。
   *
   * 返回语义（本计划偏差 3 钉死）：
   * - string：formatted_address（可能被调用方按列宽截断）
   * - null：provider 明确成功但确定无地址（如高德 status=1 而 formatted_address 空）——
   *   调用方消费即终态，不重试
   * - 抛错：本次尝试失败（网络/超时/HTTP 非 2xx/业务 status 非 1/畸形响应）——
   *   调用方传播给 outbox processor 走既有指数退避
   */
  reverse(lat: number, lng: number): Promise<string | null>;
}
```

- [ ] **Step 4: 实现 amap.provider.ts**

Create `apps/server/src/geocode/amap.provider.ts`：
```ts
import { NonRetryableLLMError, RetryableLLMError } from '../llm/base.provider.js';
import type { GeocodeProvider } from './base.provider.js';
import { wgs84ToGcj02 } from './gcj02.js';

/** 高德 Web 服务 v3 逆地理编码端点（计划偏差 7：常量而非环境变量） */
export const AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo';

export interface AmapProviderOptions {
  apiKey: string;
  /** 请求超时毫秒，默认 10000（计划偏差 8：regeo 轻量同步接口，10s） */
  timeoutMs?: number;
}

/** 高德 regeo 响应体的局部形状 */
interface AmapRegeoResponse {
  /** 业务状态：字符串 "1" 才是成功 */
  status?: unknown;
  info?: unknown;
  regeocode?: { formatted_address?: unknown };
}

/**
 * 高德逆地理编码实现（spec §4）。
 * GET {AMAP_REGEO_URL}?key=...&location=lng,lat
 * - 入参 WGS-84，**先 wgs84ToGcj02 换算再拼接**（境外点换算函数原值返回，即「境外不偏移直接请求」）
 * - location 顺序 **lng 在前**、6 位小数（高德文档 location 规则）
 * - 取 regeocode.formatted_address
 * 错误语义（计划偏差 3）：status!=="1"/HTTP 4xx 非 429/JSON 畸形 → NonRetryableLLMError；
 * HTTP 429/5xx/网络/超时 → RetryableLLMError；status==="1" 但无非空 formatted_address → null。
 */
export class AmapProvider implements GeocodeProvider {
  private readonly timeoutMs: number;

  constructor(private readonly opts: AmapProviderOptions) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const gcj = wgs84ToGcj02(lat, lng);
    const url =
      `${AMAP_REGEO_URL}?key=${encodeURIComponent(this.opts.apiKey)}` +
      `&location=${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'GET', signal: controller.signal });
    } catch (err) {
      // AbortError（超时）或网络错误（ECONNREFUSED 等）都是可重试的（对齐 openai-compat.provider 范式）
      clearTimeout(timer);
      throw new RetryableLLMError(
        err instanceof Error && err.name === 'AbortError'
          ? `geocode request timed out after ${this.timeoutMs}ms`
          : `geocode network error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (resp.status === 429 || resp.status >= 500) {
      throw new RetryableLLMError(`geocode HTTP ${resp.status}: ${resp.statusText}`);
    }
    if (resp.status >= 400) {
      throw new NonRetryableLLMError(`geocode HTTP ${resp.status}: ${resp.statusText}`, resp.status);
    }

    const data = await safeJson(resp);
    if (!data) {
      throw new NonRetryableLLMError('geocode returned invalid JSON', resp.status);
    }
    if (data.status !== '1') {
      // 高德业务失败（INVALID_USER_KEY / DAILY_QUERY_OVER_LIMIT / CUQPS 限流等）。
      // 注意：这里分类为 NonRetryable 仅是 HTTP provider 范式的错误类型标注——
      // geocode handler 对所有抛出一律传播退避（见 handlers.ts 的 handleMomentGeocode 注释）。
      throw new NonRetryableLLMError(
        `geocode amap status ${String(data.status)}: ${String(data.info ?? 'unknown')}`,
        resp.status,
      );
    }

    const address = data.regeocode?.formatted_address;
    // status=1 但拿不到非空地址 → 确定无结果（null），不抛错不重试（计划偏差 3）
    if (typeof address !== 'string' || address.length === 0) return null;
    return address;
  }
}

/** 安全解析 JSON 响应体，失败返回 null */
async function safeJson(resp: Response): Promise<AmapRegeoResponse | null> {
  try {
    return (await resp.json()) as AmapRegeoResponse;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/geocode/amap-provider.test.ts`
Expected: PASS，10 个用例全过（成功路径 3 + 错误分类 7）。

- [ ] **Step 6: 写失败测试 — factory 三态单例**

Create `apps/server/tests/geocode/factory.test.ts`（纯单测，不触库；三态范式对齐 `tests/llm/factory.test.ts`）：
```ts
import { jest } from '@jest/globals';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { AmapProvider } from '../../src/geocode/amap.provider.js';
import { getGeocodeProvider, setGeocodeProvider } from '../../src/geocode/factory.js';

describe('getGeocodeProvider（三态单例，逐字复刻 llm/factory.ts 范式）', () => {
  afterEach(() => setGeocodeProvider(undefined)); // 重置回真实 config 行为（undefined = 回落 singleton）

  it('注入 mock provider → 返回该 mock（override 生效，单例语义）', () => {
    const mock: GeocodeProvider = { reverse: jest.fn() };
    setGeocodeProvider(mock);
    expect(getGeocodeProvider()).toBe(mock);
    expect(getGeocodeProvider()).toBe(mock); // 同一实例
  });

  it('注入 null → 返回 null（空 key 停用形态的注入模拟）', () => {
    setGeocodeProvider(null);
    expect(getGeocodeProvider()).toBeNull();
  });

  it('重置(undefined) → 回落真实 config 行为（不残留注入值）', () => {
    setGeocodeProvider(undefined);
    // 测试库 .env 未配置 AMAP_WEB_KEY（config.test.ts 已断言默认空串）→ null；
    // 与 tests/llm/factory.test.ts 同款容忍式：不把测试环境是否配 key 写死进断言
    const provider = getGeocodeProvider();
    expect(provider === null || provider instanceof AmapProvider).toBe(true);
    // 重点是重置后回落真实而非注入值
    const mock: GeocodeProvider = { reverse: jest.fn() };
    setGeocodeProvider(mock);
    setGeocodeProvider(undefined);
    expect(getGeocodeProvider()).toBe(provider);
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/geocode/factory.test.ts`
Expected: FAIL，`Cannot find module '../../src/geocode/factory.js'`。

- [ ] **Step 8: 实现 factory.ts**

Create `apps/server/src/geocode/factory.ts`（三态语义逐字复刻 `llm/factory.ts`）：
```ts
import { config } from '../config.js';
import type { GeocodeProvider } from './base.provider.js';
import { AmapProvider } from './amap.provider.js';

// 三态语义（与 llm/factory.ts 逐字同范式，null 是合法计算值，故用 undefined 区分「未求值/无注入」）：
//   singleton: undefined=未求值; null=已求值且空 key; provider=已求值且有 key
//   override:  undefined=无注入（回落真实 config 行为）; null|provider=注入值
let singleton: GeocodeProvider | null | undefined;
let override: GeocodeProvider | null | undefined;

/**
 * geocode provider factory 单例（spec people-place §4）。
 * AMAP_WEB_KEY 为空 → 返回 null（逆地理编码整体停用：坐标照存、place_name 留空、
 * outbox 消费即跳过，管线不阻断——同 recap 的 LLM_API_KEY 停用模式，spec §4/§8）。
 * 有 key → 返回 AmapProvider 单例。
 */
export function getGeocodeProvider(): GeocodeProvider | null {
  if (override !== undefined) return override;
  if (singleton === undefined) {
    singleton = config.AMAP_WEB_KEY ? new AmapProvider({ apiKey: config.AMAP_WEB_KEY }) : null;
  }
  return singleton;
}

/** 测试注入点（与 setLLMProvider / setASRProvider 同范式）。传 undefined 重置回真实 config 行为；严禁业务代码使用。 */
export function setGeocodeProvider(p: GeocodeProvider | null | undefined): void {
  override = p;
}
```

- [ ] **Step 9: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/geocode/`
Expected: PASS，本目录全部测试通过（gcj02 5 + config 3 + amap-provider 10 + factory 3）。

- [ ] **Step 10: typecheck + lint**

Run:
```bash
pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```
Expected: 全部 exit 0。

- [ ] **Step 11: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/geocode/base.provider.ts apps/server/src/geocode/amap.provider.ts apps/server/src/geocode/factory.ts \
  apps/server/tests/geocode/amap-provider.test.ts apps/server/tests/geocode/factory.test.ts
git commit -m "feat(server): add geocode provider abstraction with amap regeo implementation"
```

---

### Task 4: worker handler `moment.geocode`（消费 + 条件回填 + 退避终败）

**Files:**
- Modify: `apps/server/src/worker/handlers.ts`（import `getGeocodeProvider` + `PLACE_NAME_MAX_CHARS` + `handleMomentGeocode` + 注册表条目）
- Test: `apps/server/tests/worker/handle-moment-geocode.test.ts`

**Interfaces:**
- Consumes（P2 Produces 逐字引用 + 既有符号）:
  - `OUTBOX_MOMENT_GEOCODE = 'moment.geocode'`（`src/outbox/types.ts`，**P2 Task 3 已落地**，本计划不改——见偏差 2）；payload 形状 `{ momentId: string; lat: number; lng: number }`（camelCase，P2 偏差 1）。handler 只消费 `payload.momentId`（偏差 4：坐标以重读的行为准）。
  - Task 3 Produces：`getGeocodeProvider(): GeocodeProvider | null`、`GeocodeProvider.reverse(lat: number, lng: number): Promise<string | null>`、`setGeocodeProvider`（测试注入）
  - 既有：`OutboxHandler = (payload: Record<string, unknown>, deps: { push: PushService }) => Promise<void>` 与 `handlers` 注册表（`src/worker/handlers.ts`，注册键用字符串字面量，对齐既有全部条目）；`runOutboxBatch` + `RETRY_DELAYS_MS` 5 档退避语义（`src/worker/processor.ts`：任何抛出 → attempts+1 + 档位退避；attempts>5 → status=failed + error 日志，即「终败仅记日志不重派」）；`moments` 行 `placeLat/placeLng/placeName/placeSource/deletedAt`（P1 落地）；`str(v)` 助手（handlers.ts 既有）
  - 测试：`resetDb()/closeDb()`、`registerUser/createChain/insertMoment`（`tests/helpers/*.js`）
- Produces（P4/P7 依赖）:
  - `handleMomentGeocode: OutboxHandler`（`src/worker/handlers.ts` 导出；注册表键 `'moment.geocode'`）——P7 e2e 的「geocode mock 回填」场景经 runOutboxBatch 真实分发消费
  - 行为契约：exif 坐标的 moment 消费后 `place_name` 回填（截断 255）、`place_source` 不变仍为 `exif`；空 key / 软删 / 非 exif / 名已非空 → 消费即跳过；provider 抛错 → 传播退避
  - `getGeocodeProvider` / `setGeocodeProvider` / `GeocodeProvider`（Task 3 Produces 的再声明，P7 e2e mock 注入点）

- [ ] **Step 1: 写失败测试**

Create `apps/server/tests/worker/handle-moment-geocode.test.ts`（触库；范式对齐 `tests/worker/handle-moment-transcribe.test.ts`：`setGeocodeProvider` 注入 mock + 直查 moments 行断言）：
```ts
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { moments, outbox } from '../../src/db/schema.js';
import { RetryableLLMError } from '../../src/llm/base.provider.js';
import type { GeocodeProvider } from '../../src/geocode/base.provider.js';
import { setGeocodeProvider } from '../../src/geocode/factory.js';
import { handleMomentGeocode } from '../../src/worker/handlers.js';
import { runOutboxBatch } from '../../src/worker/processor.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import type { PushService } from '../../src/push/push-service.js';

const mockPush = { send: jest.fn() } as unknown as PushService;

beforeEach(resetDb);
afterEach(() => setGeocodeProvider(undefined)); // 重置注入，防 --runInBand 下跨文件状态污染
afterAll(closeDb);

/** 造一条带 place 的 moment（默认 exif 坐标 + 空 name，即 geocode 待回填形态）。 */
async function seedMoment(opts?: {
  placeSource?: 'manual' | 'exif' | 'ai' | null;
  placeName?: string | null;
  placeLat?: number | null;
  placeLng?: number | null;
  deletedAt?: Date | null;
}): Promise<string> {
  const owner = await registerUser();
  const chainId = await createChain(owner.id);
  const momentId = await insertMoment({
    chainId,
    authorId: owner.id,
    happenedAt: new Date('2026-08-20T10:00:00Z'),
  });
  await db
    .update(moments)
    .set({
      placeLat: opts?.placeLat === undefined ? 39.9042 : opts.placeLat,
      placeLng: opts?.placeLng === undefined ? 116.4074 : opts.placeLng,
      placeName: opts?.placeName === undefined ? null : opts.placeName,
      placeSource: opts?.placeSource === undefined ? 'exif' : opts.placeSource,
      deletedAt: opts?.deletedAt ?? null,
    })
    .where(eq(moments.id, momentId));
  return momentId;
}

function geocodeReturning(name: string | null, seen?: Array<{ lat: number; lng: number }>): GeocodeProvider {
  return {
    reverse: async (lat, lng) => {
      seen?.push({ lat, lng });
      return name;
    },
  };
}

async function placeRow(momentId: string) {
  const [m] = await db
    .select({
      placeName: moments.placeName,
      placeSource: moments.placeSource,
    })
    .from(moments)
    .where(eq(moments.id, momentId));
  return m;
}

describe('handleMomentGeocode（spec people-place §4）', () => {
  it('成功回填：provider 返回地址 → place_name 落库（截断 255）、place_source 仍为 exif，provider 收到行坐标', async () => {
    const momentId = await seedMoment();
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('北京市东城区东华门街道天安门广场', seen));

    await handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush });

    expect(seen).toEqual([{ lat: 39.9042, lng: 116.4074 }]);
    const row = await placeRow(momentId);
    expect(row.placeName).toBe('北京市东城区东华门街道天安门广场');
    expect(row.placeSource).toBe('exif');
  });

  it('超长地址截断到 255（worker 回填绕过 API 校验，对齐 transcribe 的 5000 截断范式，计划偏差 5）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(geocodeReturning('长'.repeat(300)));

    await handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush });

    const row = await placeRow(momentId);
    expect(row.placeName).toHaveLength(255);
    expect(row.placeName).toBe('长'.repeat(255));
  });

  it('provider 返回 null（确定无地址）→ 正常返回、place_name 留空', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(geocodeReturning(null));

    await expect(
      handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush }),
    ).resolves.toBeUndefined();

    const row = await placeRow(momentId);
    expect(row.placeName).toBeNull();
  });

  it('空 key 停用（provider null）→ 消费即跳过：正常返回、place_name 留空（坐标照存不阻断，spec §4/§8）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(null);

    await expect(
      handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush }),
    ).resolves.toBeUndefined();

    const row = await placeRow(momentId);
    expect(row.placeName).toBeNull();
    expect(row.placeSource).toBe('exif'); // 坐标列原样保留
  });

  it('moment 不存在 / 已软删 → done 跳过（worker 软删竞态，编排硬约束）', async () => {
    setGeocodeProvider(geocodeReturning('不应被回填'));
    const missing = randomUUID();
    await expect(handleMomentGeocode({ momentId: missing }, { push: mockPush })).resolves.toBeUndefined();

    const deletedId = await seedMoment({ deletedAt: new Date() });
    await handleMomentGeocode({ momentId: deletedId }, { push: mockPush });
    const row = await placeRow(deletedId);
    expect(row.placeName).toBeNull();
  });

  it('手动编辑后不覆盖：place_source=manual（或名已非空）→ 不调 provider、不写 place_name（防竞态覆盖，spec §5 冲突规则）', async () => {
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('不应被回填', seen));

    const manualSource = await seedMoment({ placeSource: 'manual', placeName: null });
    await handleMomentGeocode({ momentId: manualSource }, { push: mockPush });
    expect(await placeRow(manualSource)).toMatchObject({ placeName: null, placeSource: 'manual' });

    const namedExif = await seedMoment({ placeSource: 'exif', placeName: '用户手动改的名' });
    await handleMomentGeocode({ momentId: namedExif }, { push: mockPush });
    expect(await placeRow(namedExif)).toMatchObject({
      placeName: '用户手动改的名',
      placeSource: 'exif',
    });

    const aiNamed = await seedMoment({ placeSource: 'ai', placeName: 'AI 抽取的地名' });
    await handleMomentGeocode({ momentId: aiNamed }, { push: mockPush });
    expect(await placeRow(aiNamed)).toMatchObject({ placeName: 'AI 抽取的地名', placeSource: 'ai' });

    expect(seen).toEqual([]); // 三种形态均不应触达远端
  });

  it('坐标以重读的行为准：payload 快照坐标不消费（计划偏差 4）', async () => {
    const momentId = await seedMoment(); // 行坐标 39.9042, 116.4074
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('北京市东城区', seen));

    await handleMomentGeocode({ momentId, lat: 0, lng: 0 }, { push: mockPush }); // payload 坐标故意不同

    expect(seen).toEqual([{ lat: 39.9042, lng: 116.4074 }]);
    expect(await placeRow(momentId)).toMatchObject({ placeName: '北京市东城区' });
  });

  it('provider 抛错 → 原样传播（processor 退避；handler 不 try/catch，计划偏差 3）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider({
      reverse: async () => {
        throw new RetryableLLMError('geocode amap 429');
      },
    });

    await expect(
      handleMomentGeocode({ momentId, lat: 39.9042, lng: 116.4074 }, { push: mockPush }),
    ).rejects.toBeInstanceOf(RetryableLLMError);

    const row = await placeRow(momentId);
    expect(row.placeName).toBeNull(); // 失败不写半截状态
  });

  it('exif 但坐标列为 null（异常态防御）→ 跳过不调 provider', async () => {
    const momentId = await seedMoment({ placeLat: null, placeLng: null });
    const seen: Array<{ lat: number; lng: number }> = [];
    setGeocodeProvider(geocodeReturning('不应被回填', seen));

    await handleMomentGeocode({ momentId }, { push: mockPush });

    expect(seen).toEqual([]);
    expect((await placeRow(momentId)).placeName).toBeNull();
  });
});

describe('runOutboxBatch × moment.geocode（注册表分发 + 既有退避终败，spec §4「终败仅记日志不重派」）', () => {
  async function emitGeocodeRow(momentId: string, over: Partial<typeof outbox.$inferInsert> = {}) {
    await db.insert(outbox).values({
      id: randomUUID(),
      type: 'moment.geocode',
      payload: { momentId, lat: 39.9042, lng: 116.4074 },
      status: 'pending',
      ...over,
    });
  }

  it('已注册分发：成功路径经默认 handlers 表回填 place_name', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider(geocodeReturning('北京市东城区'));
    await emitGeocodeRow(momentId);

    const result = await runOutboxBatch({ push: mockPush }); // 默认 handlers → 证明注册表条目存在
    expect(result.done).toBe(1);
    expect(await placeRow(momentId)).toMatchObject({ placeName: '北京市东城区' });
  });

  it('失败退避：首败 attempts=1、仍 pending（既有指数退避）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider({
      reverse: async () => {
        throw new Error('AMAP_DOWN');
      },
    });
    await emitGeocodeRow(momentId);

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.retried).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).not.toBeNull();
    expect((await placeRow(momentId)).placeName).toBeNull();
  });

  it('终败：attempts=5 的行再失败 → status=failed、不重派、place_name 留空（坐标仍在，损失可接受）', async () => {
    const momentId = await seedMoment();
    setGeocodeProvider({
      reverse: async () => {
        throw new Error('AMAP_STILL_DOWN');
      },
    });
    await emitGeocodeRow(momentId, { attempts: 5 });

    const result = await runOutboxBatch({ push: mockPush });
    expect(result.failed).toBe(1);

    const [row] = await db.select().from(outbox).where(eq(outbox.type, 'moment.geocode'));
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(6);
    expect(row.nextRetryAt).toBeNull();

    const place = await placeRow(momentId);
    expect(place.placeName).toBeNull();
    expect(place.placeSource).toBe('exif'); // 坐标照存
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-geocode.test.ts`
Expected: FAIL，`handleMomentGeocode` 不存在于 `src/worker/handlers.ts` 导出（TS 编译错误 `Module '../../src/worker/handlers.js' has no exported member 'handleMomentGeocode'`）；`runOutboxBatch` 分发用例因 `'moment.geocode'` 未注册 → 行直接 failed（与 done 断言不符）。

- [ ] **Step 3: 实现 handler（handlers.ts 三处改动）**

Modify `apps/server/src/worker/handlers.ts`：

**(a) import 区**——在 `import { getLLMProvider } from '../llm/factory.js';` 之后追加一行：
```ts
import { getGeocodeProvider } from '../geocode/factory.js';
```

**(b) 常量**——在 `const TRANSCRIPT_MAX_CHARS = 5000;` 之后追加：
```ts
/** 地名截断上限：对齐 moments.place_name varchar(255) 与 dto place name max(255)——
 *  worker 回填绕过 API 校验，不截断会落出 API 写不出的值（同 TRANSCRIPT_MAX_CHARS 范式）。 */
const PLACE_NAME_MAX_CHARS = 255;
```

**(c) handler**——在 `handleMomentTranscribe` 实现之后、`handleRecapGenerate` 注释块之前追加：
```ts
/**
 * moment.geocode（spec people-place §4）：逆地理编码回填 place_name。
 * 流程：重读 moment（不存在/已软删 → done 跳过，对齐既有 handler 范式）→
 * provider null（AMAP_WEB_KEY 空，部署停用）→ done 跳过（坐标照存、place_name 留空，管线不阻断）→
 * 仅当 place_source 仍为 'exif' 且 place_name 为空才调 reverse（用户后续手动编辑/AI 回填不被覆盖，
 * spec §5 优先级 manual > exif > ai）→ 成功后条件 UPDATE 回填（WHERE 再校验 exif + 空名 + 未软删，
 * IO 后竞态防御，对齐 transcribe 的 CAS 范式）。
 *
 * 坐标以重读的行为准：payload.lat/lng 是发射时快照，不消费（计划偏差 4）。
 * 失败语义（计划偏差 3）：provider 抛错一律传播——processor 既有 5 档指数退避，
 * attempts>5 由 processor 记 error 日志并标 failed（终败仅记日志，不重派；outbox 行状态即唯一记录）。
 * 与 transcribe 的「NonRetryable 自落 failed」不同范式：geocode 无 moment 终态列可自落，
 * 且高德 status!=='1' 混杂永久/时变错误（配额次日重置、限流），提前 done 会静默丢可恢复行。
 */
export const handleMomentGeocode: OutboxHandler = async (payload) => {
  const momentId = str(payload.momentId);
  if (!momentId) return;

  // 步骤 1：幂等 + 软删竞态防御——不存在 / 已软删直接返回（spec §4/§5）
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId)).limit(1);
  if (!m || m.deletedAt) return;

  // 步骤 2：部署方停用（AMAP_WEB_KEY 空）→ 消费即跳过（坐标照存、place_name 留空）
  const provider = getGeocodeProvider();
  if (!provider) return;

  // 步骤 3：前置形态守卫——非 exif / 名已非空 / 坐标列异常 → 跳过（不浪费远端调用）
  if (m.placeSource !== 'exif' || m.placeName !== null || m.placeLat === null || m.placeLng === null) {
    return;
  }

  // 步骤 4：逆地理（入参 WGS-84，GCJ-02 换算是 provider 内部细节）
  const raw = await provider.reverse(m.placeLat, m.placeLng);
  if (raw === null) return; // 确定无地址：done，place_name 留空

  // 步骤 5：截断 + 条件回填（IO 后再校验 exif + 空名 + 未软删，防迟到结果覆盖并发手动编辑）
  const name = raw.slice(0, PLACE_NAME_MAX_CHARS);
  await db
    .update(moments)
    .set({ placeName: name })
    .where(
      and(
        eq(moments.id, momentId),
        isNull(moments.deletedAt),
        eq(moments.placeSource, 'exif'),
        isNull(moments.placeName),
      ),
    );
};
```

**(d) 注册表**——`handlers` 对象在 `'moment.transcribe': handleMomentTranscribe,` 之后追加：
```ts
  'moment.geocode': handleMomentGeocode,
```

（依赖核对：`moments` 表、`and`/`eq`/`isNull` 均已在 handlers.ts 现有 import 中；无需新增 schema import。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @moment/server test -- tests/worker/handle-moment-geocode.test.ts`
Expected: PASS，12 个用例全过（handler 9 + runOutboxBatch 集成 3）。瞬时 ECONNRESET 重跑同一命令。

- [ ] **Step 5: 全量回归 + typecheck + lint**

Run:
```bash
pnpm --filter @moment/server test && pnpm --filter @moment/server typecheck && pnpm --filter @moment/server lint
```
Expected: 全部 exit 0，全套件无回归（本计划只新增 handler 与注册表条目，不改既有 handler；`AMAP_WEB_KEY` 默认空串对既有 config 测试无影响）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/server/src/worker/handlers.ts apps/server/tests/worker/handle-moment-geocode.test.ts
git commit -m "feat(server): add moment.geocode worker handler to backfill place_name"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/server test` 全绿，含新增：`tests/geocode/gcj02.test.ts`（境内偏移量级/境外不偏移/边界矩形 5 用例）、`tests/geocode/config.test.ts`（3 用例）、`tests/geocode/amap-provider.test.ts`（成功 3 + 错误分类 7）、`tests/geocode/factory.test.ts`（三态 3）、`tests/worker/handle-moment-geocode.test.ts`（回填/截断/空 key 跳过/软删跳过/手动编辑不覆盖/null 无地址/坐标来源/抛错传播/异常态防御 + runOutboxBatch 分发/退避/终败 12 用例）
- [ ] `pnpm --filter @moment/server typecheck` / `lint` exit 0
- [ ] spec §4 逐条落实：geocode 模块三件套（base/factory/amap）+ gcj02 纯函数；坐标系（DB 恒 WGS-84、调前换算、境外不偏移、location=lng,lat）；`AMAP_WEB_KEY` zod + `.env.example`（含隐私注释）+ 空 key → null → 消费即跳过；触发时机（P2 已落地：仅坐标且 place_name 空时同事务发射——本计划只消费）；失败退避 + 终败仅记日志不重派
- [ ] 编排 T3 边界核对：factory 三态逐字复刻 `llm/factory.ts`；`reverse(lat,lng): Promise<string|null>` 入参 WGS-84 注释钉死；handler 重读时刻（软删跳过）→ provider null 跳过 → 成功回填 place_name；终败仅记日志不重派
- [ ] 隐私（spec §8）：`.env.example` 注释明示坐标会发高德；空 key 即整体停用外发
- [ ] 边界确认：未触碰 `src/outbox/types.ts`（常量随 P2 已落地，本计划仅消费）；无 `moment.extract` / `ai_extract_hash` 任何读写（P4 范围）；无新增环境变量之外的全局状态
- [ ] Produces 符号逐个可解析：`wgs84ToGcj02` / `outOfChina` / `Gcj02Point` / `GeocodeProvider` / `AmapProvider` / `AmapProviderOptions` / `AMAP_REGEO_URL` / `getGeocodeProvider` / `setGeocodeProvider` / `config.AMAP_WEB_KEY` / `handleMomentGeocode`（含注册表键 `'moment.geocode'`）

## 写完自查（起草者已执行）

- **spec 覆盖**：§4 全节（模块三件套 / 坐标系含换算与 lng,lat / AMAP_WEB_KEY 空停用 / payload 与触发时机为 P2 契约引用 / worker 软删跳过 / 回填 / 退避终败）、§5 软删竞态、§8 隐私（坐标外发声明 + 停用开关）、§9 测试策略（mock provider 断言回填/空 key 跳过/终败不重派 + gcj02 境内偏移/境外不偏移用例）、§10 容量（worker 串行、无缓存层——无代码动作）、§11 P3 出口标准（mock provider 测试全绿）。
- **占位符扫描**：无 TBD / TODO /「类似 Task N」/「适当处理」/ 示意占位代码块。
- **跨 Task 类型一致性**：Task 1 `wgs84ToGcj02(lat, lng)`（lat 在前）与 Task 3 `AmapProvider.reverse(lat, lng)`（lat 在前）一致，`location` 拼接处才换成 lng 在前；Task 2 `config.AMAP_WEB_KEY` 被 Task 3 factory 逐字消费；Task 3 `GeocodeProvider`/`getGeocodeProvider`/`setGeocodeProvider` 被 Task 4 handler 与测试逐字消费；P2 契约 `OUTBOX_MOMENT_GEOCODE = 'moment.geocode'` 与 payload `{ momentId, lat, lng }`（camelCase）在 Task 4 Interfaces 逐字引用，handler 消费仅取 `momentId`（偏差 4）。
- **量级断言实测依据**：起草时用 node 跑同一算法实测——北京 dLat 0.0014 / dLng 0.0062，上海 dLat -0.0019 / dLng 0.0045，广州 dLat -0.0027 / dLng 0.0053，乌鲁木齐 dLat 0.0012 / dLng 0.0029，哈尔滨 dLat 0.0020 / dLng 0.0060；东京/纽约/边界外点原值返回。测试断言带 (0.0005, 0.02) 对上述实测值有 2 倍以上余量。
