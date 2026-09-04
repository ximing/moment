import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { RSRoot } from '@rabjs/react';
import { FeedbackHost } from '../src/components/feedback';
import { registerGlobals } from '../src/services/register';
import { hydrateThemeChoice } from '../src/theme/preference';
import { useTheme } from '../src/theme/use-theme';

// 模块级注册（registerGlobals 内部 once-guard，Fast Refresh 安全）
registerGlobals();
void hydrateThemeChoice();

export default function RootLayout() {
  const t = useTheme();

  useEffect(() => {
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, []);

  return (
    <RSRoot>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack
          screenOptions={{
            headerBackTitle: '返回',
            headerStyle: { backgroundColor: t.bg },
            headerTintColor: t.ink,
            headerShadowVisible: false,
            headerTitleStyle: { color: t.ink, fontWeight: '600' },
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          {/* 不逐个声明 Stack.Screen：路由文件陆续落地，页面标题由各页面内的
              <Stack.Screen options={{ title }} /> 设置。 */}
        </Stack>
        <FeedbackHost />
      </View>
    </RSRoot>
  );
}
