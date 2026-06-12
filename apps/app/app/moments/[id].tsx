import { MomentPage } from '../../src/features/moment';
import { RequireAuth } from '../../src/components/RequireAuth';

export default function MomentDetailScreen() {
  return (
    <RequireAuth>
      <MomentPage />
    </RequireAuth>
  );
}
