import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    // 骨架阶段一律先落 /login：(tabs)/index 尚未创建，'/' 此阶段没有主界面可去。
    // Task 3 创建 (tabs)/index.tsx 时删除本文件——两文件同解析为 '/' 会触发 expo-router
    // 路由冲突；且此处若 replace('/') 会自指 no-op，卡死在「加载中…」闪屏。
    router.replace('/login');
  }, [router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.hint}>加载中…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { color: '#666', fontSize: 14 },
});
