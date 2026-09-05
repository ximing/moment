import { View } from 'react-native';
import { Stack } from 'expo-router';
import { OverlayNav } from '../../src/components/OverlayNav';
import { RequireAuth } from '../../src/components/RequireAuth';
import { PasswordPage } from '../../src/features/me/password';

export default function SettingsPasswordScreen() {
  return (
    <RequireAuth>
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="修改密码" />
        <PasswordPage />
      </View>
    </RequireAuth>
  );
}
