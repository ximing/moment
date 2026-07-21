import { RecapPage } from '../../../../src/features/recap/recap-page';
import { RequireAuth } from '../../../../src/components/RequireAuth';

export default function RecapScreen() {
  return (
    <RequireAuth>
      <RecapPage />
    </RequireAuth>
  );
}
