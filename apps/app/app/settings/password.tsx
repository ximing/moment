import { Stack } from 'expo-router';
import { RequireAuth } from '../../src/components/RequireAuth';
import { PasswordPage } from '../../src/features/me/password';

export default function SettingsPasswordScreen() {
  return (
    <RequireAuth>
      <Stack.Screen options={{ title: '修改密码' }} />
      <PasswordPage />
    </RequireAuth>
  );
}
