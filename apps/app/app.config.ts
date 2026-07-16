import type { ExpoConfig } from 'expo/config';

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const config: ExpoConfig = {
  name: '时刻',
  slug: 'moment',
  scheme: 'moment',
  version: '0.1.0',
  // 缺省时 @expo/prebuild-config 回退 'light'，iOS 真机包深色主题不激活（spec §3.3）
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'com.moment.app', supportsTablet: false },
  android: { package: 'com.moment.app' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // 旅行模板「添加位置」的 iOS 权限用途文案（提交 App Store 必需；Android 由插件自动补权限声明）
    ['expo-location', { locationWhenInUseUsageDescription: '记录时刻时附上当前位置，生成旅行足迹地图' }],
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
