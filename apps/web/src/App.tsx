import { Suspense, lazy } from 'react';
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
import { NotFound } from '@/pages/not-found';
import { NotificationsHome } from '@/pages/notifications';
import { RecapPage } from '@/pages/recap';
import { ShareAlbumPage } from '@/pages/share-album';
import { Shell } from '@/shell/Shell';
import { ToastProvider, ToastRegion } from '@/ui/feedback/index';

// Design Lab 只在开发构建注册：vite build 把 import.meta.env.DEV 静态替换为 false，
// lazy import 与路由分支随之死码消除，生产产物不含运行时可达的 /__design-lab。
const DesignLabPage = import.meta.env.DEV
  ? lazy(() => import('@/pages/design-lab/index'))
  : null;

export function App() {
  // 整个既有路由树外包恰好一个 ToastProvider；ToastRegion 在 provider 内、
  // 路由 / Shell / DesignLab 之外恰好渲染一个，路由跳转不重建、不叠加（plan Task 8）。
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/share/:token" element={<ShareAlbumPage />} />
        <Route path="/invites/:token" element={<InvitePage />} />
        {DesignLabPage ? (
          <Route
            path="/__design-lab"
            element={
              <Suspense fallback={null}>
                <DesignLabPage />
              </Suspense>
            }
          />
        ) : null}
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
          <Route path="/chains/:chainId/recaps/:period" element={<RecapPage />} />
          <Route path="/chains/:chainId/settings" element={<ChainSettingsPage />} />
          <Route path="/moments/:momentId" element={<MomentPage />} />
          <Route path="/notifications" element={<NotificationsHome />} />
          <Route path="/me" element={<MePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <ToastRegion />
    </ToastProvider>
  );
}

function ComposeRedirect() {
  const { chainId } = useParams();
  return <Navigate to={`/chains/${chainId}?compose=1`} replace />;
}
