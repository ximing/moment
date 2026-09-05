import { View } from 'react-native';
import { Stack } from 'expo-router';
import { OverlayNav } from '../../src/components/OverlayNav';
import { RequireAuth } from '../../src/components/RequireAuth';
import { ThemeSettingsPage } from '../../src/features/me/theme-settings';

export default function SettingsThemeScreen() {
  return (
    <RequireAuth>
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="主题" />
        <ThemeSettingsPage />
      </View>
    </RequireAuth>
  );
}
