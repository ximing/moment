import { Navigate, Route, Routes, useParams } from 'react-router';
import { RequireAuth } from '@/shell/require-auth';
import { ComposeProvider } from '@/compose/ComposeContext';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import { ChainHome } from '@/pages/ChainHome';
import { ChainSettingsPage } from '@/pages/ChainSettingsPage';
import { FeedHome } from '@/pages/FeedHome';
import { InvitePage } from '@/pages/InvitePage';
import { MePage } from '@/pages/MePage';
import { MomentPage } from '@/pages/MomentPage';
import { NotificationsHome } from '@/pages/NotificationsHome';
import { ShareAlbumPage } from '@/pages/ShareAlbumPage';
import { Shell } from '@/shell/Shell';
import { useAuth } from '@/auth/AuthProvider';

export function App() {
  return (
    <ComposeProvider>
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
    </ComposeProvider>
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
