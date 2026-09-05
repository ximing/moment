import { Stack } from 'expo-router';
import { RequireAuth } from '../../src/components/RequireAuth';
import { ProfilePage } from '../../src/features/me/profile';

export default function SettingsProfileScreen() {
  return (
    <RequireAuth>
      <Stack.Screen options={{ title: '资料' }} />
      <ProfilePage />
    </RequireAuth>
  );
}
