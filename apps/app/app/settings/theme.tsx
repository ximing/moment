import { Stack } from 'expo-router';
import { RequireAuth } from '../../src/components/RequireAuth';
import { ThemeSettingsPage } from '../../src/features/me/theme-settings';

export default function SettingsThemeScreen() {
  return (
    <RequireAuth>
      <Stack.Screen options={{ title: '主题' }} />
      <ThemeSettingsPage />
    </RequireAuth>
  );
}
