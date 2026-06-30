# apps/app — Expo React Native 客户端

## 这个目录负责什么

- 移动端客户端（Expo + expo-router），消费同一套 `@moment/dto` / `@moment/api-client` 契约。

## 放置约束

- 状态三层（rab）：全局 Service 在 `src/services/`（`register` 注册于 `src/services/register.ts`，`app/_layout.tsx` 模块级调用，AuthService 排首）；页面组件 `src/features/<name>/index.tsx` + 同目录 `<name>.service.ts`（`bindServices`，模块级 bind 一次）。跨域刷新只走 `'global'` 事件（`auth:changed` / `chain:changed` / `moment:changed` / `comment:changed`），Service 之间不互调 load。
- 读 Service 的组件必须 `observer` 或被 `bindServices` 包过；禁止解构 observable；禁止 React Context 管业务态。
- `app/*.tsx` 是薄壳：解析参数 → `service.hydrate(params)`（组件 `useEffect`）→ 渲染 feature；跳转（`router.push/back`）留组件，Service 不碰 router。
- 可复用无业务组件放 `src/components/`；纯逻辑放 `src/lib/`。

## 开发偏好

- token 存取只经 `src/lib/token-store.ts`（`onAuthCleared` 是登出/refresh 失效的单路径桥）；API 调用集中在 `src/lib/api.ts`（`client` / `apiUrl` / `webUrl`）。
- SecureStore 异步：`AuthService.ready` 是登录闸；`applyAuth` 必须先 `await setTokens` 再发任何带 token 的调用。
- 媒体管线：图片压缩后 Blob 进内存；视频一律 `fileUri` + `rn-put` 分片读盘，整文件不进内存。
- 深链接/邀请路径新增时同步检查 `app.config.ts` 的 scheme 配置。
- 推送未接入（spec 2026-08-18 起下线 Expo Push；接入国内方案时另立计划）。

## 主题与 Token（spec：`docs/superpowers/specs/2026-08-20-app-design-tokens-design.md`）

- 新代码必须消费 `useTheme()`：组件内 `const t = useTheme()` + `useMemo(() => createStyles(t), [t])`，`createStyles` 为模块级纯函数；与 theme 无关的静态布局样式可留模块级 `StyleSheet.create`。
- **禁 hex / rgba**：`src/theme/tokens.ts` 是全仓唯一允许出现颜色字面量的文件。门禁挂在 `pnpm lint`（`lint:tokens` 脚本：grep `src/` 下 hex/rgba 零命中，tokens.ts 豁免）；`app/` 薄壳同样禁止（约定约束，门禁只扫 `src/`）。
- 尺寸纪律：间距只用 `space1..space8` 档，字号只用 `fontCaption..fontInput`，可交互元素命中区 ≥ `touchMin`（44pt，不足时用 `hitSlop` 纵向补齐，不动视觉 padding）；禁止新增不进 token 表的一次性尺寸。迁移前的非档位旧值按「平移原则」原样保留（换值不换结构），不在本轮收敛；新写样式一律上档。
- Button 族纪律（`src/components/Button.tsx`）：按钮一律走 Button（variant: primary/secondary/quiet/danger），一个操作组最多一个实心高强调；删除入口用危险色文字/quiet，最终确认才用 danger 实心；`style` 只承担宽度与外部对齐，不传 padding/色彩/形状。页面级纯文字入口（无 Button 包裹的 Pressable + Text）参照同一命中区纪律，disabled/loading 时降 `disabledOpacity` 灰化。
