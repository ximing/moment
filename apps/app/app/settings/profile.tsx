import { View } from 'react-native';
import { Stack } from 'expo-router';
import { OverlayNav } from '../../src/components/OverlayNav';
import { RequireAuth } from '../../src/components/RequireAuth';
import { ProfilePage } from '../../src/features/me/profile';

export default function SettingsProfileScreen() {
  return (
    <RequireAuth>
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <OverlayNav title="资料" />
        <ProfilePage />
      </View>
    </RequireAuth>
  );
}
