# Android Release 构建（GitHub Actions）— 设计 spec

> 日期：2026-08-23
> 状态：已批准
> Spec 引用：本文件为自包含设计，无对应上游 spec。

## 1. 目标与范围

### 目标
当 GitHub **发布 Release**（非草稿）时，自动构建一个**已签名**的 Android release APK，并把它作为资产附加到该 Release，供家庭几台设备 sideload 安装。

- 固定 release keystore 签名 → 新版本可在设备上**覆盖升级**旧版（versionCode 严格递增）。
- Android-only：用户无 iOS 证书，iOS 不在本次范围。
- 不依赖 EAS Build 云端，不消耗 EAS 配额。

### 不在范围
- iOS 构建、EAS Build、Play Store 提交（AAB）。
- server / web 构建（已有 `docker-build.yml`）。
- 现有 `docker-build.yml` 的任何改动。

## 2. 背景与现状

- `apps/app` — Expo SDK 54（`expo ~54.0.0`）/ React Native 0.81.4，**managed workflow**（仓库内无 `android/`/`ios` 原生目录，需 `expo prebuild` 生成）。
- `app.config.ts` — `version: '0.1.0'`，`android.package: 'com.moment.app'`，无 `android.versionCode`（缺省为 1）。
- `eas.json` — 已有 `production` profile，但本次不使用 EAS。
- `@moment/dto`、`@moment/api-client` 均从 `./dist/index.js` 导出（`type: module`）→ metro 打包 app 前必须先构建这两个包的 `dist/`。
- 现有 workflow：`.github/workflows/docker-build.yml`（push to main、tag `v*.*.*` 触发，构建 server/web/backup Docker 镜像）。
- Releases 通过打 `v*.*.*` tag 创建。

## 3. 触发模型

```yaml
on:
  release:
    types: [published]
```

- 与用户表述「发布 release 时构建」一致；此时 Release 对象已存在，workflow 直接把产物挂到该 Release。
- 与 `docker-build.yml`（`on.push.tags: ['v*.*.*']`）解耦，二者各自独立、互不影响。`release.published` 仅在「发布」时触发（草稿不触发），语义比 tag push 更贴合「发布 release」。

### 并发
```yaml
concurrency:
  group: android-release-${{ github.event.release.tag_name }}
  cancel-in-progress: false
```
同一 Release 的多次重跑不互相打断（发布构建宁可跑完也不要中途取消）。

## 4. 构建策略

ubuntu-latest runner 上本地构建：

```
pnpm install --frozen-lockfile
   → pnpm --filter @moment/app... build      # 构建 dto/api-client 的 dist/，顺带 typecheck app
   → expo prebuild --platform android --clean  # managed → 生成 android/
   → ./gradlew assembleRelease                 # 产出已签名 APK
```

- **Node 20** + pnpm（pnpm store 缓存）。
- **JDK 17**（temurin）— React Native 0.81 / AGP 8.x 要求 JDK 17。
- Android SDK：runner 自带，prebuild 不会要求额外组件。
- gradle 缓存（`actions/cache`，key 含 `gradle/wrapper/gradle-wrapper.properties` + `android/build.gradle` 的 hash）。

## 5. 版本号派生

从 Release tag 派生 app 版本，注入 `app.config.ts`：

- tag `v1.2.3` → `APP_VERSION_NAME=1.2.3`，`APP_VERSION_CODE=10203`。
- versionCode 公式：`major * 10000 + minor * 100 + patch`（保证严格递增 → 覆盖升级可行）。
- tag 不匹配 `^v?\d+\.\d+\.\d+$` 时 job 失败（fail-fast，避免误发未签名/版本错乱的包）。

派生逻辑用一个小 bash 步骤完成，通过 `$GITHUB_ENV` 把两个变量导出给后续步骤。

## 6. 签名方案：固定 keystore + inline config plugin

### 6.1 keystore 管理
用户本地一次性生成 keystore，base64 编码后上传为 GitHub Secret。每次 CI 用同一份签名 → versionCode 递增即可覆盖升级。

### 6.2 注入签名配置的方式（实现里唯一非平凡处）
`expo prebuild --clean` 每次会重新生成 `android/`，因此不能手改 `build.gradle`。采用 **inline config plugin**（`@expo/config-plugins` 的 `withAppBuildGradle`，随 expo 附带，无需新增依赖），在 `app.config.ts` 里向生成的 `android/app/build.gradle` 注入 `signingConfigs.release` 块。

**关键约束：该 plugin 只引用 `System.getenv(...)`**——密钥不落盘、不进 `build.gradle` 文本、不进 git。签名变量通过环境变量在 gradlew 执行时注入：

```groovy
// 注入后的 build.gradle 片段（示意）
android {
  signingConfigs {
    release {
      storeFile System.getenv("RELEASE_STORE_FILE") ? file(System.getenv("RELEASE_STORE_FILE")) : null
      storePassword System.getenv("RELEASE_STORE_STORE_PASSWORD")
      keyAlias System.getenv("RELEASE_KEY_ALIAS")
      keyPassword System.getenv("RELEASE_KEY_PASSWORD")
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
```

> plugin 的确切 API 与 groovy 注入字符串在实现阶段用 Expo 官方文档（context7）按 SDK 54 核实写法；spec 锁定的是「inline plugin + getenv 引用、不落盘」这一不变量。

### 6.3 CI 里密钥如何进入环境
- `ANDROID_KEYSTORE`（base64）→ 解码到 `$RUNNER_TEMP/release.keystore`（临时盘，job 结束清理）。
- 把路径与明文密码通过 `$GITHUB_ENV` 导出为 `RELEASE_STORE_FILE` / `RELEASE_STORE_STORE_PASSWORD` / `RELEASE_KEY_ALIAS` / `RELEASE_KEY_PASSWORD`，供 `./gradlew assembleRelease` 读取。
- `EXPO_PUBLIC_API_URL` 同样经 `$GITHUB_ENV` 导出，供 `app.config.ts` 读取。

## 7. 需要新增的 GitHub Secrets

| Secret | 值 | 用途 |
|---|---|---|
| `ANDROID_KEYSTORE` | keystore 文件的 base64 | 解码到临时盘供 gradle 签名 |
| `ANDROID_KEY_ALIAS` | keystore alias | `RELEASE_KEY_ALIAS` |
| `ANDROID_KEYSTORE_PASSWORD` | store 密码 | `RELEASE_STORE_STORE_PASSWORD` |
| `ANDROID_KEY_PASSWORD` | key 密码 | `RELEASE_KEY_PASSWORD` |
| `EXPO_PUBLIC_API_URL` | 生产 API 地址 | 注入 app（现 `eas.json` 里是 `example.com` 占位，需用户填真实地址） |

> 这五个 Secret 是**部署前提**，不在 CI 代码里硬编码。Spec 末尾附 keystore 生成与 base64 编码的操作手册。

## 8. 工作流文件结构

新增 `.github/workflows/android-release.yml`，单 job `build-android`：

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
      contents: write      # 写 Release 资产
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Build workspace deps (dto, api-client)
        run: pnpm --filter @moment/app... build

      - name: Setup JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Parse version from tag
        id: ver
        run: |                          # 见 §5
          ...

      - name: Prepare signing env
        run: |                          # 见 §6.3
          ...

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

> 上面的 `Parse version` / `Prepare signing env` 步骤体在实现阶段补全为可运行的完整脚本（无占位）。

## 9. 代码改动（`apps/app/app.config.ts`）

两处改动：

1. **版本号读 env**：
   ```ts
   const version = process.env.APP_VERSION_NAME ?? '0.1.0';
   const versionCode = Number(process.env.APP_VERSION_CODE ?? 1);
   // ...
   version,
   android: { package: 'com.moment.app', versionCode },
   ```
   让 CI 能从 tag 派生版本；本地开发缺省回退 `0.1.0` / `1`，不影响日常。

2. **签名 inline config plugin**：新增 ~15 行 plugin 函数（`withAppBuildGradle`），把 §6.2 的 groovy 块注入生成的 `build.gradle`。plugin 注册到 `plugins` 数组。本地开发无签名 env 时 gradle 会回退 debug 签名，不影响本地跑。

> 不改 `eas.json`（EAS 路径保留，本次不用）；不改 `docker-build.yml`。

## 10. 测试策略

- **workflow 语法校验**：本地用 `actionlint`（若有）或 `yamllint` 校验 yaml；CI 内靠 GitHub 的 workflow 解析器（语法错会直接报红）。
- **app.config.ts 回退**：确认无 env 时 `version`/`versionCode` 落到缺省值，本地 `pnpm --filter @moment/app typecheck` 通过、`expo prebuild --platform android` 本地能生成 `android/`。
- **首次实跑**：发布一个 `v0.1.0` Release → 观察 workflow 绿、Release 出现 APK 资产、下载 APK 在真机安装成功、再次发布 `v0.1.1` 后能覆盖升级（versionCode 递增生效）。
- 不写自动化单测（CI workflow 无单测范式；以实跑为准）。

## 11. 操作手册（部署前提，给用户的一次性步骤）

### 11.1 生成 keystore
```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore moment-release.keystore \
  -alias moment-release \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Moment, O=Moment, C=CN"
# 会提示输入并确认 store 密码、key 密码
```

### 11.2 base64 编码并上传 Secret
```bash
base64 -i moment-release.keystore | pbcopy   # macOS；Linux 用 base64 moment-release.keystore
```
到 GitHub 仓库 `Settings → Secrets and variables → Actions` 新增 5 个 Secret（见 §7）。`moment-release.keystore` 本地妥善保管，**不要进 git**。

### 11.3 设置生产 API 地址
把 `EXPO_PUBLIC_API_URL` 设为真实生产 API 地址。

### 11.4 首次发布
打 tag `git tag v0.1.0 && git push origin v0.1.0`，在 Releases 页点「Create release」并发布，等待 workflow 跑完，Release 出现 APK。
