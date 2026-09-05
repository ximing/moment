import { SearchPage } from '../src/features/search';
import { RequireAuth } from '../src/components/RequireAuth';

export default function SearchScreen() {
  return (
    <RequireAuth>
      <SearchPage />
    </RequireAuth>
  );
}
