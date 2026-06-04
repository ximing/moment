import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { loginInputSchema, registerInputSchema } from '@moment/dto';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field, Input } from '@/ui/Field';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginInputSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError('请填写正确的邮箱和密码');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(parsed.data);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="登录时刻">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="邮箱">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="密码">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && <Banner>{error}</Banner>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        还没有账号？{' '}
        <Link to="/register" state={location.state} className="text-ink underline">
          注册
        </Link>
      </p>
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('两次密码不一致');
      return;
    }
    const parsed = registerInputSchema.safeParse({ email, password, nickname });
    if (!parsed.success) {
      setError('请检查邮箱、名字和密码（密码至少 8 位）');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(parsed.data);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="加入时刻">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="邮箱">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="你的名字">
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <Field label="密码">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="再输一遍密码">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <Banner>{error}</Banner>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? '注册中…' : '注册'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        已有账号？{' '}
        <Link to="/login" state={location.state} className="text-ink underline">
          登录
        </Link>
      </p>
    </AuthFrame>
  );
}

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-center text-sm text-muted">时刻</p>
        <h1 className="mb-8 mt-1 text-center font-display text-3xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}
