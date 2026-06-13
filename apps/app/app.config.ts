import type { ExpoConfig } from 'expo/config';

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const config: ExpoConfig = {
  name: '时刻',
  slug: 'moment',
  scheme: 'moment',
  version: '0.1.0',
  platforms: ['ios', 'android'],
  ios: { bundleIdentifier: 'com.moment.app', supportsTablet: false },
  android: { package: 'com.moment.app' },
  plugins: ['expo-router', 'expo-secure-store'],
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
