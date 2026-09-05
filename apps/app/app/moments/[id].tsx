import { Stack } from 'expo-router';
import { MomentPage } from '../../src/features/moment';
import { RequireAuth } from '../../src/components/RequireAuth';

export default function MomentDetailScreen() {
  return (
    <RequireAuth>
      <Stack.Screen options={{ headerShown: false }} />
      <MomentPage />
    </RequireAuth>
  );
}
