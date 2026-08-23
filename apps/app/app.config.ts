import type { ExpoConfig } from 'expo/config';
import { type ConfigPlugin, withAppBuildGradle } from '@expo/config-plugins';

// CI 从 release tag 派生版本（见 .github/workflows/android-release.yml）；本地缺省回退。
const version = process.env.APP_VERSION_NAME ?? '0.1.0';
const versionCode = Number(process.env.APP_VERSION_CODE ?? 1);

/**
 * 向生成的 android/app/build.gradle 注入 release 签名配置。
 * 密钥只读 System.getenv，永不落盘、不进 git。
 * Expo 模板默认用 signingConfigs.debug 签 release；Gradle 合并多个 android {} 块时对冲突的
 * signingConfig 赋值后写覆盖前（last-write-wins），故本块的 signingConfigs.release 覆盖模板
 * 默认，无 EAS 插件介入。signingConfigs.release 的字段仅在 RELEASE_STORE_FILE 环境变量存在
 * 时（CI）才赋值；本地缺该变量时 signingConfig 为空，但本地走 debug 构建（expo start），
 * release 签名仅在 CI 生效。
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

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const config: ExpoConfig = {
  name: '时刻',
  slug: 'moment',
  scheme: 'moment',
  version,
  // 缺省时 @expo/prebuild-config 回退 'light'，iOS 真机包深色主题不激活（spec §3.3）
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'com.moment.app', supportsTablet: false },
  android: { package: 'com.moment.app', versionCode },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // 旅行模板「添加位置」的 iOS 权限用途文案（提交 App Store 必需；Android 由插件自动补权限声明）
    ['expo-location', { locationWhenInUseUsageDescription: '记录时刻时附上当前位置，生成旅行足迹地图' }],
    // @expo/config-types 将 plugins 标为 (string | [] | [string] | [string, any])[]，未含函数插件；
    // 运行时接受 ConfigPlugin（见 expo config-plugins/mods 文档），此 cast 仅弥合静态类型缺口。
    withEnvReleaseSigning as any,
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl,
    webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173',
    // Expo serializeAndEvaluate treats null as {} (typeof null === 'object'),
    // and Expo Go then path.basename({}) on extra.eas.projectId. undefined stays absent.
    eas: { projectId: process.env.EAS_PROJECT_ID ?? undefined },
  },
};

export default config;
