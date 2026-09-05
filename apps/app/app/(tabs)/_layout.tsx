import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type AppLineIconName } from '../../src/components/Icon';
import { RequireAuth } from '../../src/components/RequireAuth';
import { useTheme } from '../../src/theme/use-theme';

function TabIcon({ name, focused }: { name: AppLineIconName; focused: boolean }) {
  const t = useTheme();
  return <Icon name={name} size={22} color={focused ? t.ink : t.muted} />;
}

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tabPad = Math.max(insets.bottom, t.space5);
  return (
    <RequireAuth>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: t.surface,
            borderTopColor: t.line,
            paddingTop: t.space1,
            paddingBottom: tabPad,
            height: 48 + tabPad,
          },
          tabBarActiveTintColor: t.ink,
          tabBarInactiveTintColor: t.muted,
          tabBarLabelStyle: { fontSize: t.fontCaption },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: '时刻流', tabBarIcon: ({ focused }) => <TabIcon name="house" focused={focused} /> }}
        />
        <Tabs.Screen
          name="chains"
          options={{ title: '我的链', tabBarIcon: ({ focused }) => <TabIcon name="link-2" focused={focused} /> }}
        />
        <Tabs.Screen
          name="notifications"
          options={{ title: '通知', tabBarIcon: ({ focused }) => <TabIcon name="bell" focused={focused} /> }}
        />
        <Tabs.Screen
          name="me"
          options={{ title: '我', tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} /> }}
        />
      </Tabs>
    </RequireAuth>
  );
}
