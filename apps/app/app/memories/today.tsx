import { Stack } from 'expo-router';
import { MemoriesTodayPage } from '../../src/features/memories';
import { RequireAuth } from '../../src/components/RequireAuth';

export default function MemoriesTodayScreen() {
  return (
    <RequireAuth>
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <MemoriesTodayPage />
      </>
    </RequireAuth>
  );
}
