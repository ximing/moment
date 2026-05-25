import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { FeedPage } from '@/pages/FeedPage';
import { ChainsPage } from '@/pages/ChainsPage';
import { ChainDetailPage } from '@/pages/ChainDetailPage';
import { ComposePage } from '@/pages/ComposePage';
import { MomentDetailPage } from '@/pages/MomentDetailPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        {/* 功能子路由由 Task 5–10 依次加入（feed / chains / compose / moments / notifications） */}
        <Route path="/" element={<FeedPage />} />
        <Route path="/chains" element={<ChainsPage />} />
        <Route path="/chains/:chainId" element={<ChainDetailPage />} />
        <Route path="/chains/:chainId/compose" element={<ComposePage />} />
        <Route path="/moments/:momentId" element={<MomentDetailPage />} />
      </Route>
      <Route path="*" element={<div className="p-8 text-center text-gray-500">页面不存在</div>} />
    </Routes>
  );
}
