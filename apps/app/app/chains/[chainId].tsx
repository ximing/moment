import { Stack } from 'expo-router';
import { ChainHomePage } from '../../src/features/chain-home';
import { RequireAuth } from '../../src/components/RequireAuth';

export default function ChainDetailScreen() {
  return (
    <RequireAuth>
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ChainHomePage />
      </>
    </RequireAuth>
  );
}
