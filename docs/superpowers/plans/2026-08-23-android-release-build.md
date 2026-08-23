# Android Release 构建（GitHub Actions）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打 GitHub Release（`v*.*.*` tag 发布）时，自动构建已签名的 Android release APK 并附加到该 Release。

**Architecture:** `release.published` 触发单 job：ubuntu runner 上 `pnpm` 构建 workspace 依赖 → `expo prebuild --platform android` 生成原生工程 → `./gradlew assembleRelease` 用固定 keystore 签名产出 APK → 挂到 Release。签名密钥经 inline config plugin 注入 `app/build.gradle`，只读 `System.getenv`，不落盘。

**Tech Stack:** Expo SDK 54 / RN 0.81（managed workflow），`@expo/config-plugins` 的 `withAppBuildGradle`，GitHub Actions（pnpm/action-setup, setup-node, setup-java 17, upload-artifact, softprops/action-gh-release）。

**Spec:** `docs/superpowers/specs/2026-08-23-android-release-build-design.md`

## Global Constraints

- 本计划**无单元测试**——spec §10 明确：CI workflow 与 Expo config plugin 无单测范式，以 typecheck / 本地 prebuild 检查 / yaml 语法校验 / 真实 Release 实跑为准。每个 Task 的「验证」步骤即其测试周期。
- 不改 `eas.json`、不改 `.github/workflows/docker-build.yml`。
- 不新增 npm 依赖：`@expo/config-plugins` 是 `expo` 的传递依赖，SDK 54 已随附。
- Android-only：不触碰 iOS 任何配置。
- ESM NodeNext：TS 相对 import 一律带 `.js` 后缀（本计划改的 `app.config.ts` 是根入口，无相对 import）。
- conventional commits：`feat(app): ...` / `ci(app): ...`。
- 秘密（keystore、密码、生产 API URL）一律走 GitHub Secrets，**严禁**进代码或注释。

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/app/app.config.ts` | 读 env 派生 version/versionCode；inline plugin 注入 env 签名到 `app/build.gradle` | Modify |
| `.github/workflows/android-release.yml` | release.published 触发 → 构建 → 挂 APK 到 Release | Create |

---

### Task 1: app.config.ts — 版本读 env + 签名 inline config plugin

**Files:**
- Modify: `apps/app/app.config.ts`

**Interfaces:**
- Consumes: 无（根配置入口）。
- Produces:
  - 环境变量契约（CI 注入、本地可缺省）：`APP_VERSION_NAME: string`（如 `1.2.3`，缺省 `'0.1.0'`）；`APP_VERSION_CODE: string|number`（如 `10203`，缺省 `1`）；`RELEASE_STORE_FILE` / `RELEASE_STORE_STORE_PASSWORD` / `RELEASE_KEY_ALIAS` / `RELEASE_KEY_PASSWORD`（签名，本地缺省时回退 unsigned）；`EXPO_PUBLIC_API_URL`（既有）。
  - `withEnvReleaseSigning: ConfigPlugin`——注册到 `plugins` 数组的 inline function plugin。

**背景（实现者必读）：** Expo prebuild 默认会自动应用 `EasBuild` config plugin，它写一个 `android/app/eas-build.gradle`，其中 `tasks.whenTaskAdded` 块在**运行期**检查 `if (storeFile && !System.getenv("EAS_BUILD"))`——若 `storeFile` 已被设值则跳过、日志一行并退出。因此我们在主 `app/build.gradle` 末尾追加一个合并的 `android { signingConfigs { release {...} } }` 块（Gradle 允许多个 `android{}` 块合并），从 `System.getenv` 取值：env 在（CI）→ 签名生效，EAS 块见 storeFile 已设则跳过；env 不在（本地 dev）→ `if (storeFilePath != null)` 守卫跳过，EAS 块无 credentials.json → release 无签名（本地 dev 跑 debug，不影响）。无冲突。

- [ ] **Step 1: 阅读现状 `apps/app/app.config.ts`**

确认当前结构：`version: '0.1.0'`、`android: { package: 'com.moment.app' }`、`plugins: ['expo-router','expo-secure-store',['expo-location',{...}]]`、`import type { ExpoConfig } from 'expo/config';`。

- [ ] **Step 2: 替换 import，加入 config-plugins**

把第 1 行 import 改为：

```ts
import type { ExpoConfig } from 'expo/config';
import { type ConfigPlugin, withAppBuildGradle } from '@expo/config-plugins';
```

- [ ] **Step 3: 在 import 与 `const apiUrl` 之间插入版本派生与签名 plugin**

在 `import` 之后、`const apiUrl = ...` 之前插入：

```ts
// CI 从 release tag 派生版本（见 .github/workflows/android-release.yml）；本地缺省回退。
const version = process.env.APP_VERSION_NAME ?? '0.1.0';
const versionCode = Number(process.env.APP_VERSION_CODE ?? 1);

/**
 * 向生成的 android/app/build.gradle 注入 release 签名配置。
 * 密钥只读 System.getenv，永不落盘、不进 git。
 * EAS 的 eas-build.gradle 在 tasks.whenTaskAdded 里检测到 storeFile 已设即跳过，互不冲突。
 */
const SIGNING_BLOCK = `// --- begin moment env signing (injected by withEnvReleaseSigning) ---
android {
    signingConfigs {
        release {
            def storeFilePath = System.getenv("RELEASE_STORE_FILE")
            if (storeFilePath != null) {
                storeFile file(storeFilePath)
                storePassword System.getenv("RELEASE_STORE_STORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
// --- end moment env signing ---`;

const withEnvReleaseSigning: ConfigPlugin = (config) => {
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('RELEASE_STORE_FILE')) {
      mod.modResults.contents += `\n${SIGNING_BLOCK}\n`;
    }
    return mod;
  });
};
```

- [ ] **Step 4: 接入 version / versionCode**

把 config 对象里的 `version: '0.1.0',` 改为 `version,`；把 `android: { package: 'com.moment.app' },` 改为 `android: { package: 'com.moment.app', versionCode },`。

- [ ] **Step 5: 注册 plugin**

把 `plugins` 数组末尾追加 `withEnvReleaseSigning,`：

```ts
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-location', { locationWhenInUseUsageDescription: '记录时刻时附上当前位置，生成旅行足迹地图' }],
    withEnvReleaseSigning,
  ],
```

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @moment/app typecheck`
Expected: PASS（无报错）。`@expo/config-plugins` 类型可解析（expo 传递依赖）。

- [ ] **Step 7: 本地 prebuild 验证签名块注入**

Run:
```bash
cd apps/app
pnpm exec expo prebuild --platform android --clean
grep -c 'RELEASE_STORE_FILE' android/app/build.gradle
```
Expected: 输出 `1`（块已注入且幂等，只出现一次）。

再确认无 env 时签名守卫生效（不应硬编码任何密钥）：
```bash
grep -n 'RELEASE_STORE_FILE\|RELEASE_STORE_STORE_PASSWORD\|RELEASE_KEY_ALIAS\|RELEASE_KEY_PASSWORD' android/app/build.gradle
```
Expected: 仅出现 `System.getenv("RELEASE_STORE_FILE")` 等引用，**无任何明文密钥/路径字面量**。

清理本地生成物（`android/` 已在 `apps/app/.gitignore`，无需手动删；若想干净可 `rm -rf apps/app/android`）。

- [ ] **Step 8: Commit**

```bash
git add apps/app/app.config.ts
git commit -m "feat(app): derive version from env and inject release signing via config plugin"
```

---

### Task 2: 新增 `.github/workflows/android-release.yml`

**Files:**
- Create: `.github/workflows/android-release.yml`

**Interfaces:**
- Consumes: Task 1 的 env 契约（`APP_VERSION_NAME`/`APP_VERSION_CODE`/`RELEASE_STORE_FILE`/`RELEASE_STORE_STORE_PASSWORD`/`RELEASE_KEY_ALIAS`/`RELEASE_KEY_PASSWORD`/`EXPO_PUBLIC_API_URL`）。
- Produces: Release 资产 `app-release.apk`（`apps/app/android/app/build/outputs/apk/release/app-release.apk`）。

**依赖说明（实现者必读）：** `@moment/dto`、`@moment/api-client` 均从 `./dist/index.js` 导出 → metro 打包 app 前必须先 build 这两个包。`pnpm --filter @moment/app... build`（注意 `...` 表示连同其 workspace 依赖一起）会先 build dto/api-client 再 build app（app 的 `build` 脚本是 `tsc --noEmit`，顺带 typecheck）。然后 `expo prebuild`。

- [ ] **Step 1: 创建 workflow 文件**

写入 `.github/workflows/android-release.yml`（完整内容，无占位）：

```yaml
name: Build Android Release APK

on:
  release:
    types: [published]

concurrency:
  group: android-release-${{ github.event.release.tag_name }}
  cancel-in-progress: false

jobs:
  build-android:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Build workspace deps (dto, api-client) and typecheck app
        run: pnpm --filter @moment/app... build

      - name: Setup JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
            apps/app/android/.gradle
          key: gradle-${{ runner.os }}-${{ hashFiles('apps/app/android/**/build.gradle', 'apps/app/android/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: gradle-${{ runner.os }}-

      - name: Parse version from tag
        id: ver
        run: |
          tag="${{ github.event.release.tag_name }}"
          if [[ "$tag" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
            major=${BASH_REMATCH[1]}; minor=${BASH_REMATCH[2]}; patch=${BASH_REMATCH[3]}
            version_name="${major}.${minor}.${patch}"
            version_code=$(( major * 10000 + minor * 100 + patch ))
            {
              echo "version_name=$version_name"
              echo "version_code=$version_code"
            } >> "$GITHUB_OUTPUT"
            {
              echo "APP_VERSION_NAME=$version_name"
              echo "APP_VERSION_CODE=$version_code"
            } >> "$GITHUB_ENV"
          else
            echo "::error::Release tag '$tag' does not match v?MAJOR.MINOR.PATCH"
            exit 1
          fi

      - name: Prepare signing env
        env:
          ANDROID_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE }}
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
          EXPO_PUBLIC_API_URL: ${{ secrets.EXPO_PUBLIC_API_URL }}
        run: |
          keystore="$RUNNER_TEMP/release.keystore"
          printf '%s' "$ANDROID_KEYSTORE" | base64 -d > "$keystore"
          {
            echo "RELEASE_STORE_FILE=$keystore"
            echo "RELEASE_STORE_STORE_PASSWORD=$ANDROID_KEYSTORE_PASSWORD"
            echo "RELEASE_KEY_ALIAS=$ANDROID_KEY_ALIAS"
            echo "RELEASE_KEY_PASSWORD=$ANDROID_KEY_PASSWORD"
            echo "EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"
          } >> "$GITHUB_ENV"

      - name: Expo prebuild (android)
        run: pnpm --filter @moment/app exec expo prebuild --platform android --clean

      - name: Build release APK
        run: ./gradlew assembleRelease
        working-directory: apps/app/android

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: moment-android-${{ steps.ver.outputs.version_name }}
          path: apps/app/android/app/build/outputs/apk/release/*.apk
          if-no-files-found: error

      - name: Attach APK to Release
        uses: softprops/action-gh-release@v2
        with:
          files: apps/app/android/app/build/outputs/apk/release/*.apk
```

**要点说明：**
- `Prepare signing env` 用 `env:` 映射读 secret（避免 secret 文本被插入 shell 脚本），再写入 `$GITHUB_ENV` 供 gradle 进程读。`ANDROID_KEYSTORE` 是 base64 文本，`base64 -d` 解码到 `$RUNNER_TEMP/release.keystore`（job 结束自动清理）。
- `Parse version` 把 `APP_VERSION_NAME`/`APP_VERSION_CODE` 写入 `$GITHUB_ENV`（供 `app.config.ts` 读）并把 `version_name` 写 `$GITHUB_OUTPUT`（供 artifact 命名）。
- `if-no-files-found: error`：APK 没产出则该步红，避免空 Release。

- [ ] **Step 2: YAML 语法校验**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/android-release.yml')); print('yaml ok')"
```
Expected: 输出 `yaml ok`。若装了 `actionlint` 则额外跑 `actionlint .github/workflows/android-release.yml`（可选，非必需）。

- [ ] **Step 3: 复核无硬编码密钥**

Run:
```bash
grep -nE 'password|keystore|secret' .github/workflows/android-release.yml
```
Expected: 仅出现 `secrets.ANDROID_KEYSTORE*` 引用与 `$GITHUB_ENV` 写入，无任何明文密钥。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/android-release.yml
git commit -m "ci(app): build signed Android release APK on release publish"
```

---

### Task 3: 部署前提（Secrets）与首次实跑验收

**Files:**
- 无代码改动；本 Task 是一次性部署操作 + 验收清单（DoD）。若实现者需留痕，可在 `apps/app/CLAUDE.md` 末尾追加一节指向 spec §11，但**不强制**（spec 已是单一真相源）。

**Interfaces:**
- Consumes: Task 2 的 workflow；Task 1 的 env 契约。
- Produces: 一个真实可下载、可安装、可覆盖升级的签名 APK Release。

**前置条件：** GitHub 仓库 `Settings → Secrets and variables → Actions` 已配置以下 5 个 Secret（值由用户提供，实现者不持有）：

| Secret | 来源 |
|---|---|
| `ANDROID_KEYSTORE` | 本地 keystore 的 base64（见 spec §11.1–11.2） |
| `ANDROID_KEY_ALIAS` | keystore alias（如 `moment-release`） |
| `ANDROID_KEYSTORE_PASSWORD` | store 密码 |
| `ANDROID_KEY_PASSWORD` | key 密码 |
| `EXPO_PUBLIC_API_URL` | 真实生产 API 地址（替换 `eas.json` 里的 `example.com` 占位） |

> 若任一 Secret 缺失，workflow 在 `Prepare signing env` 或 `assembleRelease` 步骤失败——这是预期行为，不视为代码缺陷。

- [ ] **Step 1: 确认 Secrets 已就位**

实现者（或与用户确认）在仓库 Settings 核对上述 5 个 Secret 均已存在。无需读取值。

- [ ] **Step 2: 首次发布触发**

由用户执行（实现者不可代打 tag/发 Release）：
```bash
git tag v0.1.0
git push origin v0.1.0
```
然后在 GitHub Releases 页基于 `v0.1.0` tag **Create release** 并 **Publish**（非草稿）。

- [ ] **Step 3: 观察 workflow 成功**

在仓库 Actions 页确认 `Build Android Release APK` workflow 绿（所有 step 通过）。

- [ ] **Step 4: 确认 APK 挂载到 Release**

确认 `v0.1.0` Release 的 Assets 里有 `app-release.apk`（或 `moment-...apk`），可下载。

- [ ] **Step 5: 真机安装验收**

下载 APK，在 Android 设备 sideload 安装成功，能启动、登录、看到时间线。

- [ ] **Step 6: 覆盖升级验收（验证 versionCode 递增 + 固定 keystore）**

由用户发第二个版本：
```bash
git tag v0.1.1
git push origin v0.1.1
```
发布 `v0.1.1` Release → workflow 跑完 → 下载新 APK → **在不卸载 v0.1.0 的情况下**直接安装 v0.1.1。
Expected: 系统提示「更新应用」而非「签名冲突/需先卸载」，安装后版本变为 0.1.1。这证明固定 keystore + versionCode 递增生效。

- [ ] **Step 7: 记录验收结果**

在交付说明里记录：`v0.1.0` 与 `v0.1.1` 两次实跑均成功，APK 可下载、可安装、可覆盖升级。无需 commit（无代码改动）。

---

## Self-Review

**1. Spec 覆盖：**
- §3 触发（release.published）+ 并发 → Task 2 workflow 头部 ✓
- §4 构建策略（pnpm build → prebuild → gradlew assembleRelease）→ Task 2 steps ✓
- §5 版本派生（tag → name/code，公式，非法 tag fail）→ Task 2 `Parse version` step ✓
- §6 签名（固定 keystore + inline plugin + getenv 不落盘 + EAS 互斥说明）→ Task 1 plugin + Task 2 `Prepare signing env` ✓
- §7 五个 Secrets → Task 3 表格 ✓
- §8 workflow 结构 → Task 2 完整 yaml ✓
- §9 app.config.ts 两处改动 → Task 1 ✓
- §10 测试策略（无单测，typecheck/prebuild/yaml/实跑）→ Global Constraints + 各 Task 验证步 ✓
- §11 操作手册 → Task 3 + spec §11 引用 ✓

**2. 占位符扫描：** 无 TBD/TODO/「适当处理」/「类似 Task N」。yaml 与 groovy、TS 均为完整可运行内容。

**3. 类型/命名一致性：**
- env 变量名跨 Task 一致：Task 1 读取 `APP_VERSION_NAME`/`APP_VERSION_CODE`/`RELEASE_STORE_FILE`/`RELEASE_STORE_STORE_PASSWORD`/`RELEASE_KEY_ALIAS`/`RELEASE_KEY_PASSWORD`/`EXPO_PUBLIC_API_URL`；Task 2 写入同名。✓
- plugin 名 `withEnvReleaseSigning` 在 Task 1 定义并注册，无其他 Task 引用（无需跨 Task 对齐）。✓
- artifact path `apps/app/android/app/build/outputs/apk/release/*.apk` 在 Task 2 upload 与 attach 步骤一致。✓
