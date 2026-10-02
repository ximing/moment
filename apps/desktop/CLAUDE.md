# apps/desktop — Tauri 桌面壳

macOS、Windows、Linux 共用的原生窗口。不打包 Web，窗口加载线上 `https://moment.aimo.plus`。

## 怎么跑

- 开发：`pnpm --filter @moment/desktop start`（`tauri dev`）
- 安装包：在对应系统上 `pnpm --filter @moment/desktop bundle`（`tauri build`）
  - macOS：`.app` / `.dmg`
  - Windows：NSIS / MSI，安装时拉取 WebView2
  - Linux：`.deb` / `.rpm` / AppImage，系统需有 webkit2gtk
- 脚本故意不叫 `dev` / `build`。根目录 `pnpm dev` 和 `pnpm build` 不会拉起或编译这个壳。

## 发布

在 GitHub 上发布标签形如 `v主.次.修订` 的 Release（与 Android 同一条）。`.github/workflows/desktop-release.yml` 会构建并把安装包挂到这个 Release 上：

- macOS Apple 芯片、macOS Intel：`.dmg` 和 `.app.tar.gz`
- Windows：NSIS 安装包和 `.msi`
- Linux x64、Linux arm64：`.deb`、`.rpm`、AppImage

安装包版本号取自标签，不取 `tauri.conf.json` 里的 `0.1.0`。要重打已有 Release，在 Actions 里手动跑 `Build Desktop Release` 并填那个标签。

这些包没有 Apple 或 Windows 代码签名。macOS 首次打开要在系统设置里放行。

## 边界

- 标识 `plus.aimo.moment`。安装名 `Moment`，窗口标题「时刻」。图标来自 `apps/app/assets/icon.png`。
- 顶层导航只留在 `moment.aimo.plus`（以及 `about` / `blob` / `data`）。别的地址交给系统浏览器。
- 不把 Tauri IPC 暴露给线上页面。`capabilities` 没有 remote `urls`。
- `dragDropEnabled` 为 false，Windows 上网页自己的文件拖放才能进时刻编辑。
- 依赖 Rust。改 `src-tauri` 后至少 `cargo check`。
