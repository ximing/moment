import { useAuth } from '@/auth/AuthProvider';
import { ThemeToggle } from '@/ui/ThemeToggle';

export function MePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div>
      <h1 className="font-display text-2xl">我</h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-muted">名字</dt>
          <dd className="text-lg">{user.nickname}</dd>
        </div>
        <div>
          <dt className="text-muted">邮箱</dt>
          <dd>{user.email}</dd>
        </div>
      </dl>
      <div className="mt-8">
        <h2 className="text-sm text-muted">主题</h2>
        <div className="mt-2">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
