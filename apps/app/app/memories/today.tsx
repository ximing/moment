import { MemoriesTodayPage } from '../../src/features/memories';
import { RequireAuth } from '../../src/components/RequireAuth';

export default function MemoriesTodayScreen() {
  return (
    <RequireAuth>
      <MemoriesTodayPage />
    </RequireAuth>
  );
}
