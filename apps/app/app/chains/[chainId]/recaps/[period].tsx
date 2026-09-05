import { Stack } from 'expo-router';
import { RecapPage } from '../../../../src/features/recap/recap-page';
import { RequireAuth } from '../../../../src/components/RequireAuth';

export default function RecapScreen() {
  return (
    <RequireAuth>
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <RecapPage />
      </>
    </RequireAuth>
  );
}
