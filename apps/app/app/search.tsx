import { Stack } from 'expo-router';
import { SearchPage } from '../src/features/search';
import { RequireAuth } from '../src/components/RequireAuth';

export default function SearchScreen() {
  return (
    <RequireAuth>
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SearchPage />
      </>
    </RequireAuth>
  );
}
