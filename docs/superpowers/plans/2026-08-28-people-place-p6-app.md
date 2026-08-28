# 时刻人物与地点 P6：app 编辑器（原生 EXIF）+ 人物选择器 / 地点输入 + 卡片展示 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地「时刻人物与地点」的 app 端闭环：expo-image-picker `exif: true` 读取**压缩前原始 asset** 的 EXIF（绕开压缩剥 EXIF 的失败模式），纯函数 `src/lib/exif-gps.ts` 解析 GPS（兼容 Android/iOS 扁平键与旧 Expo iOS 嵌套 `{GPS}` 两种结构、number/string 两种值形态，**先 fixture 测试验证两条解析路径再真机确认**——spec §3 钉死的顺序）；ComposeService 增加人物/地点草稿与 **dirty tracking**（`personIds`/`place` 动作级/字段级判脏，undefined = 不变，语义逐条对齐 P5 已评审结论）；发布面板加**人物选择器**（链成员置顶 + 词典搜索 + 自由文本回车新建幂等 POST + AI 角标 + 已选未入册行并入）与**地点输入**（Field + EXIF chip 可移除 + `exifDismissed` 会话拦截）；时刻卡片与详情页加人物 chip 行与地点行（只读、不可点——点击过滤属 M2）。api-client 零改动（app 直接消费共享包，persons 四方法由 P5 落地）。

**Architecture:** app 状态三层遵守 `apps/app/CLAUDE.md`：人物/地点草稿全部进 `src/features/compose/compose.service.ts`（与 `tagIds`/`tagNames` 同层，无新 Service）；选择器 UI 是同目录 props-driven observer 组件 `person-picker.tsx`（镜像 `template-fields.tsx` 的 `service` prop 范式）；EXIF 解析是 `src/lib/exif-gps.ts` 纯函数（零 expo/RN import，可在 node 环境跑 vitest fixture 测试）。API 调用全部经既有 `src/lib/api.ts` 的共享 `client`（`@moment/api-client`，P5 已加 `listPersons`/`createPerson`）。展示改 `MomentCard`（feed/链主页/往年今日共用）与 `features/moment/index.tsx`（详情页）两处，样式全走 design tokens（镜像既有 chip 范式，不发明新样式）。

**Tech Stack:** Expo 54 / expo-router 6 / expo-image-picker ~17.0.x（lockfile 实际解析 17.0.11，expo 54.0.36；`exif: true` 选项）/ @rabjs/react 9（Service + observer）/ react-native 0.81 / Vitest ^4.1.11（**新增** devDep，与 web 同款；只跑纯函数 fixture 测试，node 环境，零 RN 依赖）/ pnpm workspace（`@moment/dto` + `@moment/api-client` dist）。

**Spec:** `docs/superpowers/specs/2026-08-28-moment-people-place-design.md`（§3 客户端 EXIF 提取·app 端小节与安全信任边界、§6 API 设计与客户端提交纪律、§7 各端 UX、§8 隐私红线、§9 测试策略·web/app 条目、§11 P6 出口标准）

**上游契约:**
- P1：`docs/superpowers/plans/2026-08-28-people-place-p1-dto-schema.md`（dto 全部符号，逐字消费）
- P2：`docs/superpowers/plans/2026-08-28-people-place-p2-server-persons.md`（persons API 契约：GET viewer / POST editor 幂等 201-200 body 同形、PATCH 撞名 409 `PERSON_NAME_CONFLICT`、DELETE 204；错误码 `PERSON_NOT_IN_CHAIN` / `PERSON_NOT_FOUND` / `PERSON_USER_NOT_IN_CHAIN`；`MomentResponse.persons/place` 必填化收口）
- P5：`docs/superpowers/plans/2026-08-28-people-place-p5-web.md`（**UX 语义与 dirty tracking 纪律的镜像参照**——偏差 2 EXIF 仅草稿全空回填 + exifDismissed 会话拦截、偏差 3 动作级判脏、偏差 4 place 判脏提交完整展示态、偏差 5 place.name trim、偏差 6 全量 GET + 前端过滤、偏差 7 链成员置顶选中即建/复用、偏差 8 已选未入册行并入、偏差 9 地点行只显示 name、偏差 11 编辑回读坐标 chip 文案与 EXIF 相同、偏差 12 loadPersons 失败静默）
- 执行编排：`docs/superpowers/prompts/2026-08-28-people-place-execution.md` T6 节 + §1 M1 硬约束（EXIF 只在前端解码 / dirty tracking / source 只能 server 赋值）

## Global Constraints（只写本计划新增，通用约束继承编排 §1）

- **app 样式纪律**（`docs/superpowers/specs/2026-08-20-app-design-tokens-design.md` + `apps/app/CLAUDE.md`）：禁 hex/rgba（`pnpm lint:tokens` 门禁扫 `src/`，唯一豁免 `src/theme/tokens.ts`）；间距只用 `space1..space8` 档、字号只用 `fontCaption..fontInput`、可交互元素命中区 ≥ `touchMin`（chip 用 `minHeight` 撑，镜像 template-fields）；新文件全部上档（H1 平移豁免只适用旧值迁移，不适用本计划新文件）；chip 范式逐字镜像 `template-fields.tsx`（`hoverSoft` 底 / 选中 `ink` 色面 + `bg` 文字——primary 只留给发布/保存）；文本输入走既有 `Field` 组件；按钮一律走 `Button` 族（移除 EXIF chip 用 `quiet`）。
- **ESM 差异**：app 的 tsconfig 是 `moduleResolution: "bundler"`——相对 import **不带** `.js` 后缀（与 server/dto 的 NodeNext 约定不同，随 app 既有代码）。
- **EXIF 只在前端解码**（spec §3）：`launchImageLibraryAsync({ exif: true })` 读压缩前原始 asset 的 EXIF；服务端永不读 S3 对象字节（本计划不触 server）；解析失败/无 GPS/越界一律**静默 null**，绝不提示错误。
- **source 只能 server 赋值**（spec §3/§6）：app 任何请求不携带 source；EXIF 路只提交坐标 `{lat, lng}`（无 name，落 exif 分支，name 由 geocode 异步回填）；`PersonBrief.source` 仅用于 AI 角标展示。
- **dirty tracking 纪律**（spec §6 + P5 已评审结论）：`personIds` 动作级判脏（P5 偏差 3）、`place` 字段级判脏提交完整展示态（P5 偏差 4）、`tagIds` 保持既有全量提交范式**不动**；编辑提交对齐既有 `timeEdited` 条件携带先例（`submitEdit` 内 `if (this.timeEdited)` 的范式）。
- **fixture 测试先行再真机确认**（spec §3 钉死顺序）：Task 1 的 fixture 测试必须先于任何真机/模拟器验证完成并全绿；真机确认 GPS 实际形态写进 DoD 手测清单（含 iOS 真机确认 GPS 嵌套/扁平形态这一步）。
- **门禁顺序**：改任何 `@moment/*` 依赖消费方前先 `pnpm build`（dto/api-client dist 就绪）；app 门禁 = `pnpm --filter @moment/app test`（Task 1 起）+ `typecheck` + `lint`（含 lint:tokens）。
- 每 Task 一个 commit（conventional commits，`feat(app)` / `test(app)`）；**Commit 步骤由编排主 Agent 验收后执行，实现 SubAgent 跳过 commit，报告待提交文件清单。**

**Spec 引用与偏差（逐条注明）：**

1. **iOS 嵌套 `{GPS}` 按 spec 字面兼容，但本仓钉住的版本实测已是扁平键**：spec §3「部分 Expo 版本的 iOS 端把 GPS tag 嵌套在 `{GPS}` 子字典，而非扁平 `GPSLatitude`/`GPSLongitude` 键（Android 为扁平键）」。已核实本仓 `expo-image-picker ~17.0.x`（lockfile 实际解析 17.0.11，expo 54.0.36）源码：iOS `ImageUtils.readExifFrom` **明确把 GPS 子字典拍平成扁平键**（`exif["GPS" + key]`，源码注释 `// Copy ["{GPS}"]["<tag>"] to ["GPS<tag>"]`），Android `ImageExporter.exif()` 输出扁平 `GPSLatitude`/`GPSLongitude`（经 `exifInterface.latLong`，十进制 double）。嵌套解析路径仍按 spec 字面实现（兼容旧 Expo 版本直传 `UIImagePickerController` 原始 metadata 的形态；嵌套键名 `GPS` 与带花括号的 `'{GPS}'` 两种都接，内层键 `Latitude`/`GPSLatitude` 两种都接），fixture 测试两条路径都钉死，**真机确认 GPS 形态仍进 DoD**——spec 钉死的「先 fixture 后真机」顺序不变，真机若出现第三种形态则停手报告编排。
2. **S/W 取负用 `-Math.abs` 幂等处理**：Android `latLong` 返回**已带符号**的十进制度（Ref 为 S/W 时已是负数）；若照「Ref S → 乘 -1」的朴素实现会把已为负的值翻回正数。钉死：S/W → `-Math.abs(v)`（正负输入都归负），N/E/缺 Ref → 原样保留符号（不翻转 Android 已带符号的负值）。Ref 匹配大小写不敏感（`'s'`/`'S'` 同判）。
3. **(0,0) 幽灵坐标静默丢弃**：Android `ExifInterface.getAttributeDouble(tag, 0.0)` 的默认值失败模式——`GPSLatitude` 原始串存在但 `latLong` 因缺 Ref 解析为 null 时，EXIF_TAGS 循环（`getAttribute(tag) != null` 过滤放行原始串）仍会写入 0.0。spec 未规定；钉死 `lat === 0 && lng === 0 → null`（几内亚湾正中不是家庭坐标，防御成本为零，fixture 钉死）。
4. **app 测试基建现状 = 零；本计划新增 vitest 只覆盖纯函数**：`apps/app` 现状无任何 test 脚本、无 jest/vitest 依赖、无 `*.test.ts` 文件（已核实 `apps/app/package.json`）。spec §9「EXIF 解析函数用含 GPS 的 fixture 单测」+ 编排 T6「fixture 测试先行」落在纯函数 `src/lib/exif-gps.ts` 上——新增 vitest devDep（`^4.1.11`，与 web 同款）+ `"test": "vitest run"` script（默认 node 环境、默认 include 只命中 `src/lib/exif-gps.test.ts`，零配置文件）。ComposeService / 组件测试**不进本计划**：CONVENTIONS §4「web/app 只做 typecheck + build + lint + 手动验收清单，组件测试不进这些计划」+ app 无组件测试基建（rab Service 链路 import expo 原生模块，node 环境不可运行）——service 语义靠 typecheck + 独立复审 + DoD 手测清单钉死。app 的 vitest 是纯函数测试（不触网络/DB），不受「测试库禁并行 jest」约束影响。
5. **api-client 是共享包，app 直接消费，P6 零 api-client 改动**：app 无独立封装层（`src/lib/api.ts` 直接 `createMomentClient`，已核实）；persons 四方法（`listPersons`/`createPerson`/`renamePerson`/`removePerson`）由 P5 Task 1 落地，本计划只消费 `listPersons`/`createPerson`（`renamePerson`/`removePerson` 无 UI 入口——persons 词典管理页不在 spec §7 范围，v1 只在编辑器内建/选）。
6. **EXIF 回填入口与 web 不同、语义相同**：web 三条入口（选图/粘贴/拖拽）都汇于 `addImages`；app 只有系统相册选择器一条路（`pickMoreImages`，语音附图同路触发），视频不读 EXIF（expo-image-picker 的 `exif` 选项仅对图片生效）。多图取第一张含 GPS、仅地点草稿完全为空时回填、`exifDismissed` 会话级拦截——逐条对齐 P5 偏差 2。EXIF 读的是 picker 返回的原始 asset（压缩前），`ingestExif` 同步执行（exif 已在内存，无 web 的异步竞态，入口一处守卫即可——同步函数无竞态，无需二次守卫）。
7. **dirty tracking 逐条引用 P5 已评审结论**：动作级判脏（P5 偏差 3——删除后加回同一 ai person 的 id 集合与基线相同，集合对比会漏提交、spec §5 的 source 升级 manual 永不发生）；place 判脏提交完整展示态（P5 偏差 4——改过名字坐标随行，`placePayload()` 名字与坐标皆空 → null 显式清除）；切链清空人物词典/选择、place 草稿保留（镜像 P5 `pickChain`，与 app `setChain` 既有 images 保留行为同款）；提交前 `place.name` trim（P5 偏差 5）；未动过的人物/地点绝不整包回传（spec §6 警告的 ai 行静默升级 manual / exif place 误升级 manual 两个场景）。
8. **AI 角标无 hover/长按提示**：spec §7「AI 抽取的 chip 带轻标识（如"AI"角标/淡色），长按/悬停提示来源」——RN 无 hover，app 钉死为 chip 内「AI」后缀（`text-muted` 轻标识）+ `accessibilityLabel` 承载提示文案（「AI 从这条时刻的文字里认出来的人物」），不做长按弹层（v1 无弹层组件基建，收益不抵复杂度）。
9. **展示层地点行只显示 `name`**（P5 偏差 9 镜像）：`place.name === null`（exif 坐标待 geocode 回填）不显示地点行——裸坐标对家庭用户无意义；地点行样式镜像 MomentCard 既有 payload.geo 行（`📍 {name}` 的 `tplLine`）。编辑回读的坐标 chip 文案与 EXIF 相同（「已从照片读取位置」，P5 偏差 11 镜像——v1 全端无地图选点器，坐标唯一来源是照片）。
10. **spec §8 红线在 app 端无 UI 面**：app 无公开分享页（分享链接落 Web 端浏览器打开，`src/lib/api.ts` 的 `webUrl` 注释为证），persons/place 不存在 app 侧外发路径——引用说明，无需实现动作；红线机制（`serializeMoments` 的 `includePrivate`）由 P2 落地并双路测试钉死。
11. **词典搜索全量 GET + 前端过滤、链成员置顶选中即建/复用、已选未入册行并入 chip 组**：P5 偏差 6/7/8 逐条镜像（单链词典数十量级，spec §10 容量假设）；`loadPersons` 失败静默保持空列表（P5 偏差 12，对齐 app `loadManifest` 失败静默先例），但 `toggleMember`/`submitPersonQuery` 的 POST 失败**抛出**由组件 `Alert(humanError)`（app 既有错误通道，对齐 `onSubmit` 范式——app 无 web 的面板内 Banner 通道）。
12. **Android EXIF 在 `quality: 1` 导出管线下的存活性以真机确认为准**：expo-image-picker 的 exif 读自**导出后**的文件（`MediaHandler` → `exportedImage.exif(...)`）；`quality: 1` 且无 resize 走原始拷贝路径 EXIF 应保留，但压缩导出路径可能剥 EXIF——spec 只排除了「服务端读字节」失败模式，端上以真机确认为准（DoD 手测清单第 2 条）；若真机确认被剥，**停手报告编排主 Agent**，不得自行发明旁路（presign metadata 旁路是 spec §10 的显式演进项，本期不做）。

---

### Task 1: EXIF GPS 解析纯函数 + app 测试基建（vitest）+ fixture 测试

**Files:**
- Modify: `apps/app/package.json`（devDependencies 增 `vitest`；scripts 增 `test`）
- Create: `apps/app/src/lib/exif-gps.ts`
- Test: `apps/app/src/lib/exif-gps.test.ts`

**Interfaces:**
- Consumes:
  - 无代码依赖（纯函数、零 import；expo-image-picker 的 asset.exif 形态知识来自官方文档 + SDK 54 源码核实，见计划偏差 1/2/3）
  - 官方文档事实（https://docs.expo.dev/versions/latest/sdk/imagepicker/，2026-08-28 核实）：`ImagePickerOptions.exif?: boolean`（"Whether to also include the EXIF data for the image. On iOS the EXIF data does not include GPS tags in the camera case."）；`ImagePickerAsset.exif?: Record<string, any> | null`（"an object containing the image's EXIF data. The names of this object's properties are EXIF tags and the values are the respective EXIF values"）；文档**不枚举**具体 GPS 键名与平台结构差异——这正是 spec 要求 fixture 先行 + 真机确认的原因
- Produces（Task 2 / P7 消费）:
  - `interface GpsCoords { lat: number; lng: number }`（WGS-84 十进制，server 落库原值）
  - `extractAssetGps(exif: Record<string, unknown> | null | undefined): GpsCoords | null`（纯函数：兼容扁平键 `GPSLatitude/GPSLongitude/GPSLatitudeRef/GPSLongitudeRef`（Android / iOS 17.x 实测形态）与嵌套 `GPS`/`'{GPS}'` 子字典（旧 Expo iOS 形态，内层键 `Latitude`/`GPSLatitude` 都接）；值兼容 number 与 string；S/W 半球 `-Math.abs` 取负（幂等，见偏差 2）；缺 Ref 按 N/E；越界（|lat|>90 / |lng|>180）、(0,0) 幽灵值、畸形形态一律 null）
  - `firstAssetGps(assets: readonly { exif?: Record<string, unknown> | null }[]): GpsCoords | null`（多图取第一张含 GPS 的，其余忽略——spec §3 v1 不做多坐标合并）
  - **行为契约（对齐 P5 web Task 2 Produces）**：任何失败静默 null，绝不抛错、不提示；S/W 半球坐标为负数；解析只消费 asset.exif 对象（picker 已读，无文件 IO）。

- [ ] **Step 1: 安装 vitest + 接 test 脚本**

Run: `pnpm --filter @moment/app add -D vitest@4.1.11`
Expected: `apps/app/package.json` devDependencies 出现 `"vitest": "^4.1.11"`（与 web 逐字同款；精确 pin `4.1.11` 安装、保存为 `^4.1.11` 区间——若传 `vitest@^4.1.11` 会解析出最新 4.x 存档，Expected 不成立；`pnpm-lock.yaml` 同步变更）。

Modify `apps/app/package.json` — `"lint": "eslint app/ src/ && pnpm lint:tokens",` 之后追加一行：

```json
    "test": "vitest run",
```

（vitest 零配置可用：默认 node 环境、默认 include `**/*.{test,spec}.?(c|m)[jt]s?(x)` 只命中本 Task 的 `src/lib/exif-gps.test.ts`，node_modules 默认排除；不新增 vitest.config 文件。）

- [ ] **Step 2: 写失败测试**

Create `apps/app/src/lib/exif-gps.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { extractAssetGps, firstAssetGps } from './exif-gps';

// EXIF GPS 解析契约（spec people-place §3 app 端 + 编排 T6「先 fixture 测试验证两条
// 解析路径再真机确认」）：
// - 扁平键 GPSLatitude/GPSLongitude(±Ref)：Android 实测形态（latLong 十进制 double，
//   已带符号）；iOS expo-image-picker 17.x 同为扁平键（ImageUtils 拍平，源码核实）；
// - 嵌套 GPS / '{GPS}' 子字典（内层 Latitude/LatitudeRef/...）：旧 Expo iOS 直传
//   UIImagePickerController metadata 的形态（spec §3 字面要求兼容）；
// - 值兼容 number 与 string（EXIF tag 序列化后可能是字符串）；
// - S/W 取负用 -Math.abs 幂等（Android 已带符号不双负；Ref 大小写不敏感）；缺 Ref 按 N/E、
//   N/E 时负值输入原样保留；
// - 越界 / (0,0) 幽灵值（Android getAttributeDouble 默认 0.0 失败模式）/ 畸形 → null。

describe('extractAssetGps：扁平键（Android / iOS 17.x 实测形态）', () => {
  it('number 值 + N/E Ref → 正十进制', () => {
    expect(
      extractAssetGps({
        GPSLatitude: 39.9042,
        GPSLongitude: 116.4074,
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('string 值（EXIF tag 序列化形态）同样解析', () => {
    expect(
      extractAssetGps({
        GPSLatitude: '39.9042',
        GPSLongitude: '116.4074',
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('S/W Ref → 取负（spec §3：S/W 半球取负）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: 33.8688,
        GPSLongitude: 151.2093,
        GPSLatitudeRef: 'S',
        GPSLongitudeRef: 'W',
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('Android latLong 已带符号 + S Ref → 幂等不双负（偏差 2）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: -33.8688,
        GPSLongitude: -151.2093,
        GPSLatitudeRef: 'S',
        GPSLongitudeRef: 'W',
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('lowercase Ref（s/w）同判取负（偏差 2：Ref 匹配大小写不敏感）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: 33.8688,
        GPSLongitude: 151.2093,
        GPSLatitudeRef: 's',
        GPSLongitudeRef: 'w',
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('N/E Ref + 负值输入 → 原样保留符号（不翻转，偏差 2）', () => {
    expect(
      extractAssetGps({
        GPSLatitude: -33.8688,
        GPSLongitude: -116.4074,
        GPSLatitudeRef: 'N',
        GPSLongitudeRef: 'E',
      }),
    ).toEqual({ lat: -33.8688, lng: -116.4074 });
  });

  it('缺 Ref → 按 N/E 正半球（默认）', () => {
    expect(extractAssetGps({ GPSLatitude: 39.9042, GPSLongitude: 116.4074 })).toEqual({
      lat: 39.9042,
      lng: 116.4074,
    });
  });
});

describe('extractAssetGps：嵌套 {GPS} 子字典（旧 Expo iOS 形态，spec §3 字面）', () => {
  it('GPS 键嵌套 + N/E → 解析', () => {
    expect(
      extractAssetGps({
        GPS: { Latitude: 39.9042, Longitude: 116.4074, LatitudeRef: 'N', LongitudeRef: 'E' },
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('带花括号的 {GPS} 键（UIImagePickerController metadata 原始键名）同样解析', () => {
    expect(
      extractAssetGps({
        '{GPS}': { Latitude: 39.9042, Longitude: 116.4074, LatitudeRef: 'N', LongitudeRef: 'E' },
      }),
    ).toEqual({ lat: 39.9042, lng: 116.4074 });
  });

  it('嵌套 + S/W → 取负', () => {
    expect(
      extractAssetGps({
        GPS: { Latitude: 33.8688, Longitude: 151.2093, LatitudeRef: 'S', LongitudeRef: 'W' },
      }),
    ).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('嵌套内层用 GPS 前缀键名（GPSLatitude）同样接', () => {
    expect(extractAssetGps({ GPS: { GPSLatitude: 39.9, GPSLongitude: 116.4 } })).toEqual({
      lat: 39.9,
      lng: 116.4,
    });
  });
});

describe('extractAssetGps：静默 null 的全部失败形态（spec §3：失败静默不提示）', () => {
  it('exif 为 null / undefined / 空对象 / 只有无关 tag → null（缺 GPS）', () => {
    expect(extractAssetGps(null)).toBeNull();
    expect(extractAssetGps(undefined)).toBeNull();
    expect(extractAssetGps({})).toBeNull();
    expect(extractAssetGps({ Make: 'Apple', Model: 'iPhone' })).toBeNull();
  });

  it('只有纬度没有经度（或反之）→ null', () => {
    expect(extractAssetGps({ GPSLatitude: 39.9, GPSLatitudeRef: 'N' })).toBeNull();
    expect(extractAssetGps({ GPSLongitude: 116.4, GPSLongitudeRef: 'E' })).toBeNull();
  });

  it('越界坐标 → null（脏数据静默丢弃；server 还有一层 400，spec §3）', () => {
    expect(extractAssetGps({ GPSLatitude: 91, GPSLongitude: 0 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: 0, GPSLongitude: 181 })).toBeNull();
    expect(
      extractAssetGps({ GPSLatitude: -90.0000001, GPSLongitude: 0, GPSLatitudeRef: 'S' }),
    ).toBeNull();
  });

  it('(0,0) 幽灵值 → null（偏差 3：Android getAttributeDouble 默认 0.0 失败模式）', () => {
    expect(extractAssetGps({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
  });

  it('畸形值（DMS 有理数串 / 数组 / NaN / 空串）→ null', () => {
    expect(extractAssetGps({ GPSLatitude: '39/1,54/1,1512/100', GPSLongitude: 116.4 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: [39, 54, 15], GPSLongitude: 116.4 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: 'abc', GPSLongitude: 116.4 })).toBeNull();
    expect(extractAssetGps({ GPSLatitude: '', GPSLongitude: 116.4 })).toBeNull();
  });
});

describe('firstAssetGps：多图取第一张含 GPS 的（spec §3）', () => {
  const withGps = { exif: { GPSLatitude: 39.9042, GPSLongitude: 116.4074, GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } };

  it('第一张无 GPS、第二张有 → 取第二张；顺序反转 → 取第一张', () => {
    expect(firstAssetGps([{ exif: null }, withGps])?.lng).toBeCloseTo(116.4074, 4);
    expect(firstAssetGps([withGps, withGps])?.lat).toBeCloseTo(39.9042, 4);
  });

  it('全无 GPS / 空数组 → null；exif 键缺省（undefined）也接', () => {
    expect(firstAssetGps([{ exif: { Make: 'Apple' } }, {}])).toBeNull();
    expect(firstAssetGps([])).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @moment/app test`
Expected: FAIL，`Cannot find module './exif-gps'`（或等效模块解析错误，vitest 报 Failed to resolve import）。红后进 Step 4。

- [ ] **Step 4: 实现 exif-gps.ts**

Create `apps/app/src/lib/exif-gps.ts`：

```ts
/**
 * 原生 EXIF GPS 解析（spec people-place §3 app 端）：
 * expo-image-picker `launchImageLibraryAsync({ exif: true })` 读取**压缩前原始 asset** 的
 * EXIF（绕开压缩剥 EXIF 的失败模式，spec §0）；本模块从 asset.exif 里取出十进制 WGS-84
 * 坐标（server 落库原值，spec §4）。
 *
 * 结构兼容两种形态（spec §3）：
 * - 扁平键 GPSLatitude/GPSLongitude/GPSLatitudeRef/GPSLongitudeRef：Android 实测形态
 *   （ExifInterface.latLong，十进制 double、已带符号）；iOS 在 expo-image-picker 17.x
 *   也已拍平为同一形态（ImageUtils.readExifFrom 源码核实，见 P6 计划偏差 1）；
 * - 嵌套 GPS / '{GPS}' 子字典（内层 Latitude/LatitudeRef/...）：旧 Expo 版本 iOS 把
 *   UIImagePickerController 原始 metadata 直传的形态（spec §3 字面要求兼容）。
 * 值形态兼容 number 与 string（EXIF tag 序列化后可能是字符串）。
 *
 * 任何失败（缺 GPS / 形状异常 / 越界 / (0,0) 幽灵值）一律 null，绝不抛错、不提示
 * （spec §3 失败静默）。本文件零 expo/RN import——纯函数，node 环境可测。
 */

/** WGS-84 十进制坐标（server 落库原值，spec §4）。 */
export interface GpsCoords {
  lat: number;
  lng: number;
}

type ExifDict = Record<string, unknown>;

/** number 或可解析为有限数的 string → number；其余形态（DMS 有理数串/数组/NaN）→ null。 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 半球符号（spec §3：S/W 取负）。用 -Math.abs 幂等：Android latLong 已带符号（S/W 为负数）
 * 时不会二次取负；N/E/缺 Ref 原样保留（不翻转 Android 已带符号的负值）。Ref 匹配大小写不敏感。
 */
function applyHemisphere(value: number, ref: unknown): number {
  const r = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (r === 'S' || r === 'W') return -Math.abs(value);
  return value;
}

/** 从单个 GPS 视图（扁平 exif 本身，或嵌套 GPS 子字典内层）取 {lat, lng}；任一缺失/畸形 → null。 */
function readLatLng(view: ExifDict | null | undefined): { lat: number; lng: number } | null {
  if (!view || typeof view !== 'object') return null;
  const lat = toFiniteNumber(view.Latitude ?? view.GPSLatitude);
  const lng = toFiniteNumber(view.Longitude ?? view.GPSLongitude);
  if (lat === null || lng === null) return null;
  return {
    lat: applyHemisphere(lat, view.LatitudeRef ?? view.GPSLatitudeRef),
    lng: applyHemisphere(lng, view.LongitudeRef ?? view.GPSLongitudeRef),
  };
}

/** 取嵌套 GPS 子字典（键名 'GPS' 或带花括号的 '{GPS}'，旧 Expo iOS 两种键名都接）。 */
function pickGpsDict(exif: ExifDict): ExifDict | null {
  const nested = exif.GPS ?? exif['{GPS}'];
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as ExifDict) : null;
}

/** 从 picker asset 的 exif 对象提取十进制 GPS；无 GPS / 畸形 / 越界 / (0,0) → null（静默）。 */
export function extractAssetGps(exif: ExifDict | null | undefined): GpsCoords | null {
  if (!exif || typeof exif !== 'object') return null;
  // 扁平键优先（Android / iOS 17.x 实测形态）；嵌套 GPS 子字典兜底（旧 Expo iOS）
  const raw = readLatLng(exif) ?? readLatLng(pickGpsDict(exif));
  if (!raw) return null;
  // 客户端坐标是不可信输入（spec §3）：越界视为脏数据静默丢弃（server 还有一层 400 PLACE_COORDS_INVALID）
  if (Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) return null;
  // (0,0) 幽灵值防御（P6 计划偏差 3）：Android ExifInterface.getAttributeDouble 默认 0.0
  // 的失败模式——原始串存在但 latLong 因缺 Ref 为 null 时暴露 0.0
  if (raw.lat === 0 && raw.lng === 0) return null;
  return raw;
}

/** 多图取第一张含 GPS 的照片，其余忽略（spec §3：v1 不做多坐标合并）。 */
export function firstAssetGps(assets: readonly { exif?: ExifDict | null }[]): GpsCoords | null {
  for (const asset of assets) {
    const coords = extractAssetGps(asset.exif);
    if (coords) return coords;
  }
  return null;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @moment/app test`
Expected: PASS，18 个 it 全过（扁平 number/string、S/W、lowercase Ref 同判、N/E 负值原样保留、Android 已带符号幂等、缺 Ref；嵌套 GPS/'{GPS}'、嵌套 S/W、嵌套 GPS 前缀键；缺 GPS 五形态、半坐标、越界三形态、(0,0)、畸形四形态；firstAssetGps 两组）。

- [ ] **Step 6: 门禁（typecheck + lint 含 lint:tokens）**

Run: `pnpm build && pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint`
Expected: 全部 exit 0（test 文件被 app tsconfig 的 `src/**/*.ts` include 覆盖，`import { describe, expect, it } from 'vitest'` 显式值 import 不受 `"types": []` 影响；lint:tokens 零 hex/rgba 命中）。

- [ ] **Step 7: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/package.json pnpm-lock.yaml apps/app/src/lib/exif-gps.ts apps/app/src/lib/exif-gps.test.ts
git commit -m "feat(app): add native EXIF GPS parser with fixture tests and vitest setup"
```

---

### Task 2: pickImages 透出 EXIF + ComposeService 人物/地点草稿 + dirty tracking + submit 集成

**Files:**
- Modify: `apps/app/src/lib/media.ts`（`launchImageLibraryAsync` 加 `exif: true`，`PickedImage` 透出 exif）
- Modify: `apps/app/src/features/compose/compose.service.ts`（状态 + 方法 + hydrate/loadForEdit/setChain/pickMoreImages/submit/submitEdit 接线）

**Interfaces:**
- Consumes（P1/P2/P5 Produces + Task 1 Produces 逐字引用）:
  - `@moment/dto`：`PersonResponse`（`{id, name, userId}`）、`PersonBrief`（`{id, name, userId, source}`）、`ChainMemberDto`（`{userId, nickname, avatarUrl, role, joinedAt}`）、`MomentResponse`（P2 收口后 `persons: PersonBrief[]` / `place: MomentPlace | null` 必填）、`PatchMomentInput`（P1 后已含 `personIds?: string[]` / `place?: PlaceInput | null`）
  - P5 Produces（api-client，app 经 `src/lib/api.ts` 的 `client` 直接消费）：`client.listPersons(chainId): Promise<PersonListResponse>`、`client.createPerson(chainId, input): Promise<PersonResponse>`（幂等 create 201/200 body 同形不区分）、既有 `client.listMembers(chainId): Promise<ChainMemberDto[]>`、`client.createMoment`/`client.updateMoment`（请求体可携带 `personIds`/`place`，undefined 键不出现）
  - Task 1 Produces：`firstAssetGps(assets: readonly { exif?: Record<string, unknown> | null }[]): GpsCoords | null`（`../../lib/exif-gps`）
  - 既有 app 符号：`pickImages(): Promise<PickedImage[]>`（`src/lib/media.ts`）、`timeEdited` 条件携带先例（`submitEdit` 内 `if (this.timeEdited)` 的 patch 增量范式）
- Produces（Task 3 / P7 消费——**P7 消费 dirty tracking 纪律与 P5 Task 3 Produces 逐字同款**）:
  - `PickedImage` 增 `exif?: Record<string, unknown> | null`（picker 原始 asset 的 EXIF，压缩前）
  - ComposeService 状态：`personList: PersonResponse[]`、`members: ChainMemberDto[]`、`selectedPersons: PersonBrief[]`、`personQuery: string`、`personsTouched: boolean`、`placeName: string`、`placeCoords: { lat: number; lng: number } | null`、`placeTouched: boolean`、`exifDismissed: boolean`
  - `loadPersons(): Promise<void>`（`Promise.allSettled([client.listPersons(chainId), client.listMembers(chainId)])`——两路独立成败，各自失败静默清各自列表（词典与成员是两个接口，词典失败不牵连成员置顶）；await 后链已切换则丢弃防串链）
  - `togglePerson(person: PersonBrief): void`（动作级判脏，置 `personsTouched`）
  - `toggleMember(member: ChainMemberDto): Promise<void>`（词典/已选集 userId 命中直接选；否则幂等 `createPerson {name, userId}`；失败**抛出**由组件 Alert）
  - `submitPersonQuery(): Promise<void>`（词典同名命中直接选不 POST；否则幂等 `createPerson {name}`；成功清空 query；失败抛出）
  - `setPlaceName(name: string): void`（置 `placeTouched`）、`removePlaceCoords(): void`（置 `placeTouched` + `exifDismissed` + 清坐标）
  - submit 行为契约：新建分支 `selectedPersons.length > 0` 才带 `personIds`；`placeTouched || placeCoords` 才带 `place`（EXIF 未动过也照常上送坐标）；编辑分支 `personsTouched`/`placeTouched` 条件携带（undefined = 不变）；人物 > 20 前置抛 `Error('最多关联 20 位人物')`；`place: null` = 显式清除；任何请求不带 source

- [ ] **Step 1: 基线确认（typecheck 绿）**

Run: `pnpm build && pnpm --filter @moment/app typecheck`
Expected: exit 0（改动前基线绿；本 Task 无自动化红灯载体——app 无 Service 测试基建，见计划偏差 4，语义由独立复审 + DoD 手测清单钉死，CONVENTIONS §4）。

- [ ] **Step 2: media.ts 透出 EXIF**

Modify `apps/app/src/lib/media.ts`：

(a) `PickedImage` 接口——`height: number;` 之后追加：

```ts
  /** picker 原始 asset 的 EXIF（压缩前；spec people-place §3：exif:true 让 picker 读出，
   *  绕开压缩剥 EXIF 的失败模式）。无 EXIF / 平台不支持为 null；GPS 解析见 lib/exif-gps.ts */
  exif?: Record<string, unknown> | null;
```

(b) `pickImages()` —— `launchImageLibraryAsync` 调用参数 `quality: 1,` 之后追加一行：

```ts
    exif: true, // spec people-place §3：读压缩前原始 asset 的 EXIF（GPS 用于地点草稿回填）
```

return 行替换为（透出 exif）：

```ts
  return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, exif: a.exif ?? null }));
```

- [ ] **Step 3: ComposeService 增量实现**

Modify `apps/app/src/features/compose/compose.service.ts`：

(a) import——`@moment/dto` 的 import 行替换为（按字母序插入三个类型）：

```ts
import { MAX_IMAGE_BYTES, type ChainMemberDto, type MediaCompleteResponse, type MomentResponse, type MomentType, type PatchMomentInput, type PersonBrief, type PersonResponse, type TemplateManifest } from '@moment/dto';
```

`import { summarizePayload } from '../../lib/template';` 之后追加：

```ts
import { firstAssetGps } from '../../lib/exif-gps';
```

(b) 状态字段——`tagNames: { id: string; name: string }[] = [];` 之后追加：

```ts
  // ---- 人物与地点（spec people-place §3/§6/§7；dirty tracking 纪律镜像 P5 已评审结论）----
  /** 链 person 词典（选择器数据源，spec §6 GET persons） */
  personList: PersonResponse[] = [];
  /** 链成员（置顶 chip 数据源；选中 = 以该用户建/复用 person，spec §7） */
  members: ChainMemberDto[] = [];
  /** 选中人物全集（展示态含 source 供 AI 角标；提交时只取 id，source 永不上送） */
  selectedPersons: PersonBrief[] = [];
  personQuery = '';
  /** dirty tracking（spec §6）：仅用户实际增删过人物才提交 personIds——动作级判脏
   *  （P5 偏差 3：删除后加回同一 ai person，id 集合与基线相同也要提交，spec §5 升级路径） */
  personsTouched = false;
  /** 地点草稿：name 手动输入；coords 来自 EXIF（或编辑回读）。两者独立可组合 */
  placeName = '';
  placeCoords: { lat: number; lng: number } | null = null;
  /** dirty tracking（spec §6）：仅用户实际改过地点才提交 place；place:null = 显式清除 */
  placeTouched = false;
  /** 用户移除 EXIF chip 后本面板会话不再自动回填（否则删不掉，P5 偏差 2） */
  exifDismissed = false;
```

(c) `hydrate()` 非编辑分支——`this.manifestChainId = '';` 之后、`const active = this.activeChainId;` 之前追加：

```ts
    // 人物/地点草稿复位（spec §6）：新建面板每次进入都是干净草稿
    this.personList = [];
    this.members = [];
    this.selectedPersons = [];
    this.personQuery = '';
    this.personsTouched = false;
    this.placeName = '';
    this.placeCoords = null;
    this.placeTouched = false;
    this.exifDismissed = false;
```

同分支 `void this.loadTags().catch(() => undefined);` 之后追加：

```ts
    void this.loadPersons().catch(() => undefined);
```

(d) `loadForEdit()` —— `this.payloadDraft = { ...(m.payload ?? {}) };` 之后追加：

```ts
    // 人物/地点水合（spec §6）：编辑模式展示全集（含 ai 行，source 仅供角标）；
    // touched 标志复位——未动过就不提交（undefined = 不变，P5 偏差 3/4 同款纪律）
    this.selectedPersons = m.persons.map((p) => ({ ...p }));
    this.personsTouched = false;
    this.placeName = m.place?.name ?? '';
    this.placeCoords =
      m.place?.lat != null && m.place?.lng != null ? { lat: m.place.lat, lng: m.place.lng } : null;
    this.placeTouched = false;
    this.exifDismissed = false;
    this.personQuery = '';
```

同方法 `await this.loadTags();` 之后追加：

```ts
    void this.loadPersons().catch(() => undefined);
```

(e) `setChain()` —— `this.tagIds = [];` 之后追加（place 草稿保留——镜像 P5 `pickChain`，与 app `setChain` 既有 images 保留行为同款）：

```ts
    // 人物词典是链级作用域（spec §0）：切链丢弃旧链选择；place 草稿保留（镜像 images 切链行为）
    this.personList = [];
    this.members = [];
    this.selectedPersons = [];
    this.personsTouched = false;
```

同方法 `void this.loadManifest(id).catch(() => undefined);` 之后追加：

```ts
    void this.loadPersons().catch(() => undefined);
```

(f) `toggleTag(id)` 之后追加方法块：

```ts
  /** 拉链 person 词典 + 成员（选择器数据源）。失败静默：辅助输入不阻塞发布主流程
   *  （P5 偏差 12，对齐 loadManifest 失败静默先例）。
   *  两路独立成败（allSettled）：词典与成员来自两个接口，词典失败只清词典，不牵连成员置顶。 */
  async loadPersons(): Promise<void> {
    const chainId = this.activeChainId;
    if (!chainId) {
      this.personList = [];
      this.members = [];
      return;
    }
    const [res, members] = await Promise.allSettled([
      client.listPersons(chainId),
      client.listMembers(chainId),
    ]);
    if (this.activeChainId !== chainId) return; // 异步返回时链已切换则丢弃（防串链，对齐 loadManifest 守卫）
    this.personList = res.status === 'fulfilled' ? res.value.persons : [];
    this.members = members.status === 'fulfilled' ? members.value : [];
  }

  /** 词典行 → PersonBrief（词典行无 source；选中态语义恒 manual，spec §6 提交即 manual 意图）。 */
  private asBrief(person: PersonResponse | PersonBrief): PersonBrief {
    return 'source' in person ? person : { ...person, source: 'manual' };
  }

  /** 人物增删切换；置 personsTouched——动作级判脏（P5 偏差 3，见字段注释）。 */
  togglePerson(person: PersonBrief): void {
    this.personsTouched = true;
    this.selectedPersons = this.selectedPersons.some((p) => p.id === person.id)
      ? this.selectedPersons.filter((p) => p.id !== person.id)
      : [...this.selectedPersons, person];
  }

  /** 选中链成员 = 以该用户建/复用 person（spec §7；P5 偏差 7）：词典/已选集有 userId 命中
   *  直接选；否则幂等 POST（P2 契约：撞名归一化返回已存在行）。失败抛出，组件 Alert humanError。 */
  async toggleMember(member: ChainMemberDto): Promise<void> {
    const existing =
      this.personList.find((p) => p.userId === member.userId) ??
      this.selectedPersons.find((p) => p.userId === member.userId);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      return;
    }
    const chainId = this.activeChainId;
    if (!chainId) return;
    const person = await client.createPerson(chainId, { name: member.nickname, userId: member.userId });
    if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
    this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
  }

  /** 词典同名命中直接选（不 POST）；否则自由文本回车新建（幂等 POST，spec §6/§7）。
   *  失败抛出，组件 Alert humanError。 */
  async submitPersonQuery(): Promise<void> {
    const name = this.personQuery.trim();
    const chainId = this.activeChainId;
    if (!name || !chainId) return;
    const existing =
      this.personList.find((p) => p.name === name) ?? this.selectedPersons.find((p) => p.name === name);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      this.personQuery = '';
      return;
    }
    const person = await client.createPerson(chainId, { name });
    if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
    this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
    this.personQuery = '';
  }

  setPlaceName(name: string): void {
    this.placeTouched = true;
    this.placeName = name;
  }

  /** 移除 EXIF chip（spec §3「可点 × 移除」）：丢弃坐标且本面板会话不再自动回填（P5 偏差 2）。 */
  removePlaceCoords(): void {
    this.placeTouched = true;
    this.exifDismissed = true;
    this.placeCoords = null;
  }
```

(g) `pickMoreImages()` —— `if (remain <= 0) throw new Error(...)` 之后、`let rejected = 0;` 之前追加（并把 for 循环的 `picked.slice(0, remain)` 换成 `kept`）：

```ts
    const kept = picked.slice(0, remain);
    // EXIF 自动回填（spec §3）：读的是压缩前原始 asset（pickImages exif:true）；
    // 仅地点草稿完全为空时写入（P5 偏差 2）；非用户动作，不置 placeTouched
    this.ingestExif(kept);
```

`for (const img of picked.slice(0, remain)) {` 替换为：

```ts
      for (const img of kept) {
```

(h) `submit()` 之前追加两个 private 方法：

```ts
  /** EXIF 自动回填守卫（spec §3，P5 偏差 2 同款）：已移除 chip / 已有坐标 / 已手动输入
   *  地点名任一命中即短路。多图取第一张含 GPS 的（firstAssetGps）。 */
  private ingestExif(assets: { exif?: Record<string, unknown> | null }[]): void {
    if (this.exifDismissed || this.placeCoords || this.placeName.trim() !== '') return;
    const coords = firstAssetGps(assets);
    if (coords) this.placeCoords = coords;
  }

  /** place 提交形态（spec §6 赋值表在 server 判 source，客户端只交 name/坐标）：
   *  名字（trim 后，P5 偏差 5）与坐标皆空 → null（显式清除）；有坐标 ±名字 → 整体提交
   *  （坐标+名字 → manual「确认后的形态」；仅坐标 → exif）；仅名字 → {name}（manual 文本）。
   *  P5 偏差 4：改过名字坐标随行——仅提交名字会触发「仅名字 → manual 且坐标清空」，丢数据更差。 */
  private placePayload(): { name?: string; lat?: number; lng?: number } | null {
    const name = this.placeName.trim();
    if (name === '' && !this.placeCoords) return null;
    return this.placeCoords
      ? { ...(name !== '' ? { name } : {}), lat: this.placeCoords.lat, lng: this.placeCoords.lng }
      : { name };
  }
```

(i) `submit()` —— 方法体第一行 `if (this.edit) return this.submitEdit();` 之前追加人物上限守卫（两个分支共用）：

```ts
    if (this.selectedPersons.length > 20) throw new Error('最多关联 20 位人物');
```

新建分支 `await client.createMoment(activeChainId, { ... })` 的对象字面量内，`...(Object.keys(this.payloadDraft).length > 0 ? { payload: this.payloadDraft } : {}),` 之后追加两行：

```ts
        // 人物/地点（spec people-place §6）：create 无 dirty 语义，选中即提交；
        // EXIF 坐标未动过也照常上送（落 exif 分支，name 由 geocode 异步回填）
        ...(this.selectedPersons.length > 0 ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
        ...(this.placeTouched || this.placeCoords ? { place: this.placePayload() } : {}),
```

(j) `submitEdit()` —— `const patch: PatchMomentInput = { ... }` 对象字面量内，`payload: ...` 行之后追加：

```ts
      // dirty tracking（spec §6，P5 偏差 3/4 同款）：undefined = 不变——未动过的人物/地点
      // 绝不整包回传（否则 ai 行被静默升级 manual、exif place 误升级 manual，spec §6 警告）
      ...(this.personsTouched ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
      ...(this.placeTouched ? { place: this.placePayload() } : {}),
```

- [ ] **Step 4: 门禁确认**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app test`
Expected: 全部 exit 0（typecheck 覆盖 `PatchMomentInput` 新键的携带合法性——P1 已在 dto 落地；lint:tokens 零命中；既有 fixture 测试无回归）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/lib/media.ts apps/app/src/features/compose/compose.service.ts
git commit -m "feat(app): add persons and place draft state with dirty tracking to compose service"
```

---

### Task 3: 人物选择器 + 地点输入组件（person-picker.tsx + 面板接线 + humanError 词条）

**Files:**
- Create: `apps/app/src/features/compose/person-picker.tsx`
- Modify: `apps/app/src/features/compose/index.tsx`（import + 渲染接线）
- Modify: `apps/app/src/lib/errors.ts`（PERSON_* 错误词条）

**Interfaces:**
- Consumes（Task 2 Produces + 既有 app 符号）:
  - Task 2 的 ComposeService 状态与方法全量：`personList` / `members` / `selectedPersons` / `personQuery`（可写）/ `placeName` / `placeCoords` / `togglePerson` / `toggleMember` / `submitPersonQuery` / `setPlaceName` / `removePlaceCoords`
  - 既有组件：`Field`（`src/components/Field.tsx`——label 可见 + fieldBg 色面 + focus 描边，`...inputProps` 透传 TextInputProps，故 `onSubmitEditing`/`returnKeyType`/`placeholder` 直达）、`Button`（`src/components/Button.tsx`——variant: quiet 承担「移除」次级动作）
  - 既有 chip 范式：`template-fields.tsx` 的 `useChipStyles`（`hoverSoft` 底 / `radiusMd` / `minHeight: touchMin` / 选中 `ink` 色面 + `bg` 文字——新文件全部上 token 档）
  - 既有 `humanError`（`src/lib/errors.ts`）、`Alert` 错误通道（`compose/index.tsx` 的 `onSubmit` 范式：`Alert.alert('失败', humanError(err))`）
  - `@moment/dto`：`ChainMemberDto`、`PersonResponse`、`PersonBrief`
- Produces（P7 消费——UX 语义镜像 P5 Task 4 Produces）:
  - `PersonPicker = observer(({ service }: { service: ComposeService }) => ReactElement)`（props-driven observer，镜像 `TemplateFields` 的 `service` prop 范式；`src/features/compose/person-picker.tsx` 导出）
  - 行为契约（与 P5 Task 4 逐条对齐）：**链成员置顶 chip 组**（选中态 `ink` 色面，点击 = `toggleMember`，失败 Alert humanError）；**词典 chip 组**（`personQuery` 前端 `includes` 过滤——P5 偏差 6；已由成员 chip 代表的 userId 链接行去重——P5 偏差 7）；**已选但未入词典的行纯前端并入 chip 组置顶**（编辑模式词典未加载时已选人物含 ai 行仍可见可删——P5 偏差 8）；选中的 ai 来源行 chip 内带「AI」轻标识 + `accessibilityLabel` 提示（P6 偏差 8：RN 无 hover）；**搜索/新建输入**（`Field` label「搜索或新建人物」，`onSubmitEditing` = `submitPersonQuery`）；**地点 `Field`**（label「在哪里」，`onChangeText` = `setPlaceName`）；**EXIF chip**（文案「📍 已从照片读取位置」——编辑回读坐标同文案，P5 偏差 11 + `quiet` Button「移除」→ `removePlaceCoords`）
  - 面板接线：`compose/index.tsx` 在标签 chip 区之后渲染 `<PersonPicker service={service} />`（新建与编辑两模式都渲染——编辑模式链锁定但人物/地点可编辑）
  - `humanError` 新词条：`PERSON_NOT_IN_CHAIN` / `PERSON_NAME_CONFLICT` / `PERSON_NOT_FOUND` / `PERSON_USER_NOT_IN_CHAIN`

- [ ] **Step 1: 基线确认（typecheck 绿）**

Run: `pnpm --filter @moment/app typecheck`
Expected: exit 0（本 Task 无自动化红灯载体——CONVENTIONS §4 + 计划偏差 4；组件契约由独立复审 + DoD 手测清单钉死）。

- [ ] **Step 2: 实现 person-picker.tsx**

Create `apps/app/src/features/compose/person-picker.tsx`：

```tsx
import { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { observer } from '@rabjs/react';
import type { ChainMemberDto, PersonResponse } from '@moment/dto';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { humanError } from '../../lib/errors';
import { useTheme } from '../../theme/use-theme';
import type { Theme } from '../../theme/theme';
import type { ComposeService } from './compose.service';

// 人物选择器 + 地点输入（spec people-place §7；UX 语义镜像 web P5 Task 4 已评审结论）：
// chip 多选、链成员置顶（选中 = 以该用户建/复用 person，P5 偏差 7）、词典搜索（前端过滤，
// P5 偏差 6）、自由文本回车新建（幂等 POST）；已选未入册行并入 chip 组可见可删（P5 偏差 8）；
// AI 抽取行带「AI」轻标识 + accessibilityLabel 提示（RN 无 hover，P6 偏差 8）。
// 地点：Field 文本输入 + EXIF chip（可移除，移除后本会话不再自动回填，P5 偏差 2）；
// 编辑回读的坐标 chip 文案与 EXIF 相同（P5 偏差 11）。
// 样式纪律（app design tokens spec）：全部上 token 档，chip 范式逐字镜像 template-fields.tsx
// （hoverSoft 底 / 选中 ink 色面 + bg 文字，primary 只留给发布/保存）。
// toggleMember/submitPersonQuery 的 POST 失败由这里 Alert（app 既有错误通道，对齐 onSubmit 范式）。

function personPickerOnPressError(err: unknown): void {
  Alert.alert('失败', humanError(err));
}

export const PersonPicker = observer(function PersonPicker({ service }: { service: ComposeService }) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const query = service.personQuery.trim().toLowerCase();
  // 词典搜索（P5 偏差 6）：前端 includes 过滤；已由链成员 chip 代表的 userId 链接行不重复出现（P5 偏差 7）
  const linkedUserIds = new Set(service.members.map((m) => m.userId));
  const dictionary = service.personList.filter(
    (p) => (!p.userId || !linkedUserIds.has(p.userId)) && p.name.toLowerCase().includes(query),
  );
  // 已选但不在词典的行（编辑模式词典未加载时的 ai 人物等）并入 chip 组置顶渲染（P5 偏差 8）
  const dictionaryIds = new Set(service.personList.map((p) => p.id));
  const selectedOnly = service.selectedPersons.filter(
    (p) =>
      !dictionaryIds.has(p.id) &&
      (!p.userId || !linkedUserIds.has(p.userId)) &&
      p.name.toLowerCase().includes(query),
  );
  const selectedIds = new Set(service.selectedPersons.map((p) => p.id));
  const memberSelected = (m: ChainMemberDto) => service.selectedPersons.some((p) => p.userId === m.userId);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>和谁在一起</Text>
      <View style={styles.chipRow} accessibilityLabel="人物">
        {/* 链成员置顶（spec §7）：选中即建/复用 user_id 链接的 person */}
        {service.members.map((m) => (
          <Pressable
            key={m.userId}
            style={[styles.chip, memberSelected(m) && styles.chipActive]}
            onPress={() => void service.toggleMember(m).catch(personPickerOnPressError)}
          >
            <Text style={[styles.chipText, memberSelected(m) && styles.chipTextActive]}>{m.nickname}</Text>
          </Pressable>
        ))}
        {selectedOnly.map((p) => (
          <PersonChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
        ))}
        {dictionary.map((p) => (
          <PersonChip key={p.id} service={service} person={p} selected={selectedIds.has(p.id)} />
        ))}
      </View>
      <Field
        label="搜索或新建人物"
        value={service.personQuery}
        onChangeText={(v) => (service.personQuery = v)}
        onSubmitEditing={() => void service.submitPersonQuery().catch(personPickerOnPressError)}
        placeholder="输入名字，回车新建"
        returnKeyType="done"
      />
      <Field
        label="在哪里"
        value={service.placeName}
        onChangeText={(v) => service.setPlaceName(v)}
        placeholder="比如：外婆家"
      />
      {service.placeCoords ? (
        <View style={styles.exifRow}>
          <View style={styles.exifChip}>
            <Text style={styles.exifChipText}>📍 已从照片读取位置</Text>
          </View>
          <Button variant="quiet" onPress={() => service.removePlaceCoords()}>
            移除
          </Button>
        </View>
      ) : null}
    </View>
  );
});

/** 词典/已选 chip：选中的 ai 来源行带「AI」轻标识（spec §7），accessibilityLabel 承载来源提示。 */
const PersonChip = observer(function PersonChip({
  service,
  person,
  selected,
}: {
  service: ComposeService;
  person: PersonResponse;
  selected: boolean;
}) {
  const t = useTheme();
  const styles = useMemo(() => createStyles(t), [t]);
  const source = service.selectedPersons.find((p) => p.id === person.id)?.source;
  const isAi = selected && source === 'ai';
  return (
    <Pressable
      accessibilityLabel={isAi ? `${person.name}（AI 从这条时刻的文字里认出来的人物）` : person.name}
      style={[styles.chip, selected && styles.chipActive]}
      onPress={() =>
        service.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: source ?? 'manual' })
      }
    >
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
        {person.name}
        {isAi ? <Text style={styles.aiBadge}> AI</Text> : null}
      </Text>
    </Pressable>
  );
});

const createStyles = (t: Theme) =>
  StyleSheet.create({
    section: { gap: t.space2, marginBottom: t.space3 },
    label: { fontSize: t.fontLabel, color: t.ink },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    chip: {
      paddingHorizontal: t.space3,
      paddingVertical: t.space2,
      borderRadius: t.radiusMd,
      backgroundColor: t.hoverSoft,
      minHeight: t.touchMin,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.ink },
    chipText: { fontSize: t.fontSupport, color: t.muted },
    chipTextActive: { color: t.bg, fontWeight: '600' },
    aiBadge: { color: t.muted, fontSize: t.fontCaption },
    exifRow: { flexDirection: 'row', alignItems: 'center', gap: t.space2 },
    exifChip: { paddingHorizontal: t.space3, paddingVertical: t.space2, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    exifChipText: { fontSize: t.fontSupport, color: t.ink },
  });
```

- [ ] **Step 3: 面板接线（compose/index.tsx）**

Modify `apps/app/src/features/compose/index.tsx`：

(a) import 区 `import { TemplateFields } from './template-fields';` 之后追加：

```tsx
import { PersonPicker } from './person-picker';
```

(b) 渲染——标签 chip 区 `{service.tagNames.length > 0 ? ( ... ) : null}` 的闭合 `: null}` 之后、`{service.progressLabel ? ...}` 之前追加：

```tsx
      <PersonPicker service={service} />
```

（新建与编辑两模式都渲染：编辑模式链锁定但人物/地点是可编辑草稿——`loadForEdit` 已水合 + 复位 touched。）

(c) **链列表就绪后重触发 loadPersons**——既有 loadManifest effect（`apps/app/src/features/compose/index.tsx:30-35` 订阅 `service.activeChainId` 的那个）的 `}, [service, service.activeChainId]);` 之后追加：

```tsx
  useEffect(() => {
    // 镜像 P5 Task 4 (b)：activeChainId 经 observer 订阅 ChainListService，冷启动/深链时
    // 链列表未就绪 → hydrate 内 loadPersons 早退清空；本 effect 在链就绪后重触发补拉。
    // loadPersons 幂等（同链重复调用结果相同），与 hydrate/loadForEdit/setChain 内调用重复无害
    if (service.activeChainId) void service.loadPersons().catch(() => undefined);
  }, [service, service.activeChainId]);
```

（不加这条：新建分支冷启动时 `ChainListService` 可能未就绪 → `activeChainId` 为 undefined → hydrate 里的 `loadPersons()` 走早退分支清空词典，此后链就绪**没有任何 effect 重触发**，人物选择器永久为空——这正是 P5 Task 4 (b) 已修过的漏项，P6 镜像。）

- [ ] **Step 4: humanError 词条**

Modify `apps/app/src/lib/errors.ts` — `COPY` 映射内 `TAG_LIMIT_REACHED: '标签已达上限 100 个',` 之后追加：

```ts
  PERSON_NOT_IN_CHAIN: '这个人物不属于这条链',
  PERSON_NAME_CONFLICT: '已经有同名的人物了',
  PERSON_NOT_FOUND: '这个人已经不在了',
  PERSON_USER_NOT_IN_CHAIN: '这位家人不在链里',
```

- [ ] **Step 5: 门禁确认**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app test`
Expected: 全部 exit 0（lint:tokens 零 hex/rgba 命中；chip 尺寸全部 token 档）。

- [ ] **Step 6: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/features/compose/person-picker.tsx apps/app/src/features/compose/index.tsx apps/app/src/lib/errors.ts
git commit -m "feat(app): add person picker and place field with EXIF chip to compose"
```

---

### Task 4: 时刻卡片与详情页的人物 chip 行 + 地点行（只读展示）

**Files:**
- Modify: `apps/app/src/components/MomentCard.tsx`（persons chip 行 + place 行；feed/链主页/往年今日共用）
- Modify: `apps/app/src/features/moment/index.tsx`（详情页 persons chips + place 行）

**Interfaces:**
- Consumes（P1/P2 Produces 逐字引用）:
  - `@moment/dto`：`PersonBrief`（`{id, name, userId, source}`）、`MomentPlace`（`{lat, lng, name, source}`）、`MomentResponse`（P2 收口后 `persons: PersonBrief[]` / `place: MomentPlace | null` 必填——链内路径 feed/时间线/详情经 `serializeMoments(..., { includePrivate: true })` 恒有值）
  - 既有展示范式：MomentCard 的 payload.geo 行（`📍 {name}` 的 `tplLine` 样式）、footer tags（正文内 Tag 文本）、moment 详情页 `tagRow`；chip 底色范式（`hoverSoft` 色面）
- Produces（P7 消费——展示行为契约与 P5 Task 5 逐条对齐）:
  - MomentCard 展示行为：`moment.persons.length > 0` → 人物 chip 行（`accessibilityLabel="和谁在一起"`，**纯 View/Text 非按钮**——只读不可点，点击过滤属 M2，spec §7）；ai 来源行 chip 内带「AI」`muted` 轻标识；`moment.place?.name` 非空 → 地点行（`📍 {name}`，镜像既有 geo payload 行样式；name 为 null 的 exif 待回填坐标**不显示**——P5 偏差 9）
  - 详情页（`features/moment/index.tsx`）同款两行（persons chips + `📍 {name}` 地点行），位置在 tagRow 之后
  - 行为契约：persons/place 任何形态下都不可点击、不进导航（v1 无按人物/地点过滤）

- [ ] **Step 1: 基线确认（typecheck 绿）**

Run: `pnpm --filter @moment/app typecheck`
Expected: exit 0（本 Task 无自动化红灯载体——CONVENTIONS §4 + 计划偏差 4）。

- [ ] **Step 2: MomentCard 展示增量**

Modify `apps/app/src/components/MomentCard.tsx`：

(a) 既有 payload.geo 展示块（`{(() => { const geo = moment.payload?.geo ... })()}`）之后、`<View style={styles.footer}>` 之前追加：

```tsx
      {/* 人物与地点（spec people-place §7）：只读展示，不可点击（按人物/地点过滤属 M2）。
          chip 为非交互 View/Text（hoverSoft 色面，镜像既有 chip 底色范式）；AI 行「AI」轻标识；
          地点行镜像既有 geo payload 行样式（tplLine）；place.name 为 null（exif 坐标待
          geocode 回填）不显示地点行——裸坐标对家庭用户无意义（P5 偏差 9 镜像）。 */}
      {moment.persons.length > 0 ? (
        <View style={styles.personRow} accessibilityLabel="和谁在一起">
          {moment.persons.map((p) => (
            <View key={p.id} style={styles.personChip}>
              <Text style={styles.personChipText}>
                {p.name}
                {p.source === 'ai' ? <Text style={styles.personAi}> AI</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {moment.place?.name ? <Text style={styles.tplLine}>📍 {moment.place.name}</Text> : null}
```

(b) `createStyles` 内 `tplLine: ...` 之后追加四个样式：

```ts
    personRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2, marginTop: t.space1 },
    personChip: { paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    personChipText: { fontSize: t.fontSupport, color: t.ink },
    personAi: { color: t.muted, fontSize: t.fontCaption },
```

- [ ] **Step 3: 详情页展示增量**

Modify `apps/app/src/features/moment/index.tsx`：

(a) tags 展示块（`{m.tags.length > 0 ? ( <View style={styles.tagRow}> ... </View> ) : null}`）的闭合 `: null}` 之后追加：

```tsx
        {/* 人物与地点（spec people-place §7）：只读展示，不可点击（过滤属 M2）；
            name 为 null 的 exif 待回填坐标不显示地点行（P5 偏差 9 镜像） */}
        {m.persons.length > 0 ? (
          <View style={styles.personRow} accessibilityLabel="和谁在一起">
            {m.persons.map((p) => (
              <View key={p.id} style={styles.personChip}>
                <Text style={styles.personChipText}>
                  {p.name}
                  {p.source === 'ai' ? <Text style={styles.personAi}> AI</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {m.place?.name ? <Text style={styles.placeLine}>📍 {m.place.name}</Text> : null}
```

(b) `createStyles` 内 `tag: { color: t.tag, fontSize: t.fontSupport },` 之后追加五个样式：

```ts
    personRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 },
    personChip: { paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: t.hoverSoft },
    personChipText: { fontSize: t.fontSupport, color: t.ink },
    personAi: { color: t.muted, fontSize: t.fontCaption },
    placeLine: { color: t.muted, fontSize: t.fontSupport },
```

- [ ] **Step 4: 门禁确认（全端）**

Run: `pnpm --filter @moment/app typecheck && pnpm --filter @moment/app lint && pnpm --filter @moment/app test && pnpm --filter @moment/app build`
Expected: 全部 exit 0（`moment.persons` / `m.persons` 直取——P2 收口后必填；lint:tokens 零命中）。

- [ ] **Step 5: Commit**

> 本步骤由编排主 Agent 在验收后执行；实现 SubAgent 跳过 commit，报告待提交文件清单。

```bash
git add apps/app/src/components/MomentCard.tsx apps/app/src/features/moment/index.tsx
git commit -m "feat(app): show persons and place on moment cards and detail page"
```

---

## DoD（计划级验收）

- [ ] `pnpm --filter @moment/app test` 绿（新增 vitest fixture 测试 18 个 it：扁平 number/string、S/W 取负、lowercase Ref 同判、N/E 负值原样保留、Android 已带符号幂等、缺 Ref、嵌套 GPS/'{GPS}'、嵌套 S/W、嵌套 GPS 前缀键、缺 GPS 五形态、半坐标、越界三形态、(0,0) 幽灵、畸形四形态、firstAssetGps 两组）；`typecheck` / `build`（tsc --noEmit）/ `lint`（含 lint:tokens）exit 0
- [ ] spec §3 app 端小节逐条：`exif: true` 读压缩前原始 asset、iOS/Android 两结构兼容（fixture 先行）、其余与 web 相同（草稿态 chip + 随提交上送）、失败静默、多图第一张含 GPS、chip 可点 × 移除
- [ ] spec §6 提交纪律逐条：`personIds`/`place` 动作级/字段级判脏（undefined = 不变、`place: null` = 显式清除）、`tagIds` 全量范式未动、无任何 source 字段上送、`place.name` 提交前 trim
- [ ] spec §7 UX 边界：链成员置顶、词典搜索（前端过滤）、回车新建幂等、AI 角标轻标识 + accessibilityLabel、无地图选点、无按人物/地点点击过滤（展示 chip 为非交互 View）
- [ ] spec §8：app 无公开分享 UI 面（引用说明，红线机制在 P2 server 层钉死）
- [ ] 真机/模拟器手测清单（编排主 Agent 或用户执行；**含 iOS 真机确认 GPS 形态这一步**）：
  1. **iOS 真机**：发布页选一张带 GPS 的照片 →「📍 已从照片读取位置」chip 出现、提交成功后详情页有地点行（geocode 回填名异步到达）；同时在调试器/console 打印 `asset.exif` 确认 GPS 实际形态（临时加 `console.log(asset.exif)` 打印、验收后移除——计划代码本身不含打印；扁平 `GPSLatitude` 或嵌套 `{GPS}`）与 fixture 假设一致——spec §3「先 fixture 测试再真机确认」的收口动作；若出现 fixture 未覆盖的第三种形态，停手报告编排主 Agent
  2. **Android 真机/模拟器**：同上；重点确认 `quality: 1` 导出管线下 GPS 未被剥（P6 偏差 12——若被剥，停手报告，不得自行加旁路）
  3. 移除 EXIF chip 后再加图不复活（exifDismissed 会话拦截）；已手动输入地点名时加图不自动回填；手动名 + EXIF 坐标 → 提交 `{name, lat, lng}`
  4. 人物选择器：链成员 chip 置顶、选中即建 person（重复选择不重复建，幂等命中）；输入过滤词典；回车新建重名不报错（幂等命中）；编辑带 AI 人物的时刻 →「AI」角标可见、VoiceOver 读出提示文案
  5. 编辑一条带 AI 人物 + exif 地点的时刻，只改正文保存 → 响应中 ai 行 source 与 place_source 不变（不升级）；增删任一人物保存 → personIds 提交全集；清空地点名 + 移除 chip 保存 → place 三列清空
  6. feed / 链主页 / 往年今日卡片与详情页显示人物 chip 行与 📍 地点行；exif 坐标待回填（无 name）的时不显示地点行；人物 chip 不可点
  7. 浅色/深色主题下选择器、chip、展示行视觉正常（tokens 双主题）
- [ ] Produces 符号逐个可解析：`GpsCoords`、`extractAssetGps`、`firstAssetGps`、`PickedImage.exif`、`ComposeService` 新状态与方法（Task 2 Interfaces 全列）、`PersonPicker`、`humanError` PERSON_* 四词条、MomentCard/详情页展示行为契约

## 写完自查（起草者已执行）

- **spec 覆盖**：§3 app 端小节逐条（exif:true 原始 asset / iOS `{GPS}` 嵌套 vs Android 扁平键兼容 / fixture 测试先行再真机确认 / 其余与 web 相同：草稿态 chip + 随提交上送）；§3 安全信任边界（不传 source、坐标防御性范围检查 + (0,0) 防御、server 仍有一层 400）；§6 客户端提交纪律三条（personIds/place 判脏、tagIds 不动、timeEdited 先例对齐）；§7 编辑器与卡片全部 UX 条目 + 「明确不做」清单（无地图选点/无过滤/无合并/无词典管理页）；§8 引用说明（app 无分享 UI 面）；§9 app 条目（EXIF fixture 单测）；§11 P6 出口标准（app 手测通过）。
- **iOS GPS 嵌套兼容**：嵌套 `GPS`/`'{GPS}'` 两键名 + 内层 `Latitude`/`GPSLatitude` 两键名都接，fixture 4 个用例钉死；SDK 54 实测已拍平（源码核实）的事实写进偏差 1，真机确认仍进 DoD。
- **dirty tracking 对齐 P5 结论**：偏差 2（仅草稿全空回填 + exifDismissed）、偏差 3（动作级判脏）、偏差 4（place 判脏提交完整展示态、改名字坐标随行）、偏差 5（trim）、偏差 6/7/8/11/12 逐条引用；切链清空人物、place 保留（镜像 P5 pickChain + app images 既有行为）。
- **占位符扫描**：无 TBD / TODO /「适当处理」/「类似 Task N」。
- **跨 Task 类型一致**：Task 1 `firstAssetGps` 参数类型 `{ exif?: Record<string, unknown> | null }[]` 与 Task 2 `PickedImage.exif` / `ingestExif` 参数逐字一致；Task 2 状态字段名与 Task 3 组件消费逐字一致（`personList`/`members`/`selectedPersons`/`personQuery`/`placeName`/`placeCoords`）；`PersonResponse` vs `PersonBrief` 的联合经 `asBrief` 收口（`togglePerson` 只收 `PersonBrief`，避免 web P5 同位置的联合类型隐患）；`ChainMemberDto` 字段与 dto `chains.ts` 现状核对；`client.listPersons/createPerson/listMembers` 签名与 P5 Task 1 Produces 逐字一致。
