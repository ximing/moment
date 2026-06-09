import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { loginInputSchema } from '@moment/dto';
import { humanError } from '@/lib/errors';
import { AuthFrame } from '@/pages/auth-frame';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field, Input } from '@/ui/Field';
import { LoginService } from './login.service';

const LoginPageContent = observer(function LoginPageContent() {
  const service = useService(LoginService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginInputSchema.safeParse({ email: service.email, password: service.password });
    if (!parsed.success) {
      setError('请填写正确的邮箱和密码');
      return;
    }
    setError(null);
    void service
      .submit()
      .then(() => navigate(location.state?.from ?? '/', { replace: true }))
      .catch((err) => setError(humanError(err)));
  }

  return (
    <AuthFrame title="登录时刻">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="邮箱">
          <Input
            type="email"
            value={service.email}
            onChange={(e) => (service.email = e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field label="密码">
          <Input
            type="password"
            value={service.password}
            onChange={(e) => (service.password = e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {error && <Banner>{error}</Banner>}
        <Button type="submit" className="w-full" disabled={service.$model.submit.loading}>
          {service.$model.submit.loading ? '登录中…' : '登录'}
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
});

export const LoginPage = bindServices(LoginPageContent, [LoginService]);
