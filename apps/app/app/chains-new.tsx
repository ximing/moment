import { Stack } from 'expo-router';
import { ChainsNewPage } from '../src/features/chains-new';

export default function ChainsNewScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ChainsNewPage />
    </>
  );
}
