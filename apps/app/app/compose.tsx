import { Stack } from 'expo-router';
import { ComposePage } from '../src/features/compose';

export default function ComposeScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ComposePage />
    </>
  );
}
