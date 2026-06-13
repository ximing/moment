import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RSRoot } from '@rabjs/react';
import { registerGlobals } from '../src/services/register';

// 模块级注册（registerGlobals 内部 once-guard，Fast Refresh 安全）
registerGlobals();

export default function RootLayout() {
  return (
    <RSRoot>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerBackTitle: '返回' }}>
        {/* 不逐个声明 Stack.Screen：路由文件陆续落地，页面标题由各页面内的
            <Stack.Screen options={{ title }} /> 设置。 */}
      </Stack>
    </RSRoot>
  );
}
