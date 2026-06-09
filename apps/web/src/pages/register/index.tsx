import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { registerInputSchema } from '@moment/dto';
import { humanError } from '@/lib/errors';
import { AuthFrame } from '@/pages/auth-frame';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field, Input } from '@/ui/Field';
import { RegisterService } from './register.service';

const RegisterPageContent = observer(function RegisterPageContent() {
  const service = useService(RegisterService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (service.password !== service.confirm) {
      setError('两次密码不一致');
      return;
    }
    const parsed = registerInputSchema.safeParse({
      email: service.email,
      password: service.password,
      nickname: service.nickname,
    });
    if (!parsed.success) {
      setError('请检查邮箱、名字和密码（密码至少 8 位）');
      return;
    }
    setError(null);
    void service
      .submit()
      .then(() => navigate(location.state?.from ?? '/', { replace: true }))
      .catch(() => undefined); // API 错误横幅读 $model.submit.error，不双写本地 state
  }

  return (
    <AuthFrame title="加入时刻">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="邮箱">
          <Input type="email" value={service.email} onChange={(e) => (service.email = e.target.value)} />
        </Field>
        <Field label="你的名字">
          <Input value={service.nickname} onChange={(e) => (service.nickname = e.target.value)} />
        </Field>
        <Field label="密码">
          <Input type="password" value={service.password} onChange={(e) => (service.password = e.target.value)} />
        </Field>
        <Field label="再输一遍密码">
          <Input type="password" value={service.confirm} onChange={(e) => (service.confirm = e.target.value)} />
        </Field>
        {error && <Banner>{error}</Banner>}
        {service.$model.submit.error && <Banner>{humanError(service.$model.submit.error)}</Banner>}
        <Button type="submit" className="w-full" disabled={service.$model.submit.loading}>
          {service.$model.submit.loading ? '注册中…' : '注册'}
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
});

export const RegisterPage = bindServices(RegisterPageContent, [RegisterService]);
