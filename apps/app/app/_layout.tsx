import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { queryClient } from '../src/lib/query';
import { AuthProvider } from '../src/lib/auth';

function useNotificationRouting(): void {
  useEffect(() => {
    // 前台收到通知也展示横幅（SDK 53+ 必须显式返回 shouldShowBanner/shouldShowList）
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    let lastHandledResponseId: string | null = null;

    const openMoment = (data: unknown) => {
      const momentId = (data as { momentId?: string } | undefined)?.momentId;
      if (momentId) router.push(`/moments/${momentId}`);
    };

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (id === lastHandledResponseId) return;
      lastHandledResponseId = id;
      openMoment(response.notification.request.content.data);
    };

    // 冷启动补偿：首条 response 可能在 JS 监听器挂载前已派发，先补一次跳转
    void Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleResponse(resp);
    });

    // 点击（App 运行中）→ 跳对应 moment（Phase 5 payload.data 契约）
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleResponse(response);
    });
    return () => sub.remove();
  }, [router]);
}

export default function RootLayout() {
  useNotificationRouting();
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
