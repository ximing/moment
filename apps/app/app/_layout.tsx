import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
      <SafeAreaProvider>
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
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <FeedbackHost />
      </View>
      </SafeAreaProvider>
    </RSRoot>
  );
}
