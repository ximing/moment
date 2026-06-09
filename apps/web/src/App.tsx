import { Navigate, Route, Routes, useParams } from 'react-router';
import { RequireAuth } from '@/shell/require-auth';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { ChainHome } from '@/pages/chain-home';
import { ChainSettingsPage } from '@/pages/chain-settings';
import { FeedHome } from '@/pages/feed-home';
import { InvitePage } from '@/pages/invite';
import { MePage } from '@/pages/me';
import { MomentPage } from '@/pages/moment';
import { NotificationsHome } from '@/pages/notifications';
import { ShareAlbumPage } from '@/pages/share-album';
import { Shell } from '@/shell/Shell';
import { useAuth } from '@/auth/AuthProvider';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/share/:token" element={<ShareAlbumPage />} />
      <Route path="/invites/:token" element={<InvitePage />} />
      <Route path="/chains/:chainId/compose" element={<ComposeRedirect />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<FeedHome />} />
        <Route path="/chains/:chainId" element={<ChainHome />} />
        <Route path="/chains/:chainId/settings" element={<ChainSettingsPage />} />
        <Route path="/moments/:momentId" element={<MomentPage />} />
        <Route path="/notifications" element={<NotificationsHome />} />
        <Route path="/me" element={<MePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function ComposeRedirect() {
  const { chainId } = useParams();
  return <Navigate to={`/chains/${chainId}?compose=1`} replace />;
}

function NotFound() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <p className="py-16 text-center text-muted">没有这个页面</p>;
}
