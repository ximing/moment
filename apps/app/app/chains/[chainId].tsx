import { ChainHomePage } from '../../src/features/chain-home';
import { RequireAuth } from '../../src/components/RequireAuth';

export default function ChainDetailScreen() {
  return (
    <RequireAuth>
      <ChainHomePage />
    </RequireAuth>
  );
}
