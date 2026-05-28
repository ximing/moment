import { Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { RequireAuth } from '../../src/components/RequireAuth';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={[styles.icon, focused && styles.iconActive]}>{label}</Text>;
}

export default function TabsLayout() {
  return (
    <RequireAuth>
      <Tabs screenOptions={{ headerShown: true, tabBarLabelStyle: { fontSize: 11 } }}>
        <Tabs.Screen
          name="index"
          options={{ title: '时刻流', tabBarIcon: ({ focused }) => <TabIcon label="🏠" focused={focused} /> }}
        />
        <Tabs.Screen
          name="chains"
          options={{ title: '我的链', tabBarIcon: ({ focused }) => <TabIcon label="⛓️" focused={focused} /> }}
        />
        <Tabs.Screen
          name="notifications"
          options={{ title: '通知', tabBarIcon: ({ focused }) => <TabIcon label="🔔" focused={focused} /> }}
        />
      </Tabs>
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 18, opacity: 0.4 },
  iconActive: { opacity: 1 },
});
