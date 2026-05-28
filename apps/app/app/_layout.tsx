import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/query';
import { AuthProvider } from '../src/lib/auth';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthProvider>
        <Stack screenOptions={{ headerBackTitle: '返回' }}>
          {/* 不逐个声明 Stack.Screen：路由文件在各 Task 陆续落地，显式声明尚不存在的路由会报警。
              页面标题由各页面内的 <Stack.Screen options={{ title }} /> 设置。 */}
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
