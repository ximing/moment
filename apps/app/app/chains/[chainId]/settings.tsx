import { Stack } from 'expo-router';
import { ChainSettingsPage } from '../../../src/features/chain-settings';

export default function ChainSettingsScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ChainSettingsPage />
    </>
  );
}
