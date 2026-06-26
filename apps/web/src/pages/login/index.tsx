import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { loginInputSchema } from '@moment/dto';
import { humanError } from '@/lib/errors';
import { AuthFrame } from '@/pages/auth-frame';
// 必须显式指向 barrel 文件：src/ui/ 下同名遗留文件（Button.tsx / Banner.tsx /
// Field.tsx）在本 Task 删除前，大小写不敏感文件系统上裸目录导入会被截获。
import { Button } from '@/ui/button/index';
import { Banner } from '@/ui/feedback/index';
import { PasswordField, TextField } from '@/ui/field/index';
import { LoginService } from './login.service';

type FieldErrors = { email?: string; password?: string };

/** isInvalid 与 errorMessage 成对出现（Field 规范 §8）：返回联合类型让展开保持可分配。 */
function fieldValidation(
  message: string | undefined,
): { isInvalid: true; errorMessage: string } | { isInvalid?: false; errorMessage?: undefined } {
  return message ? { isInvalid: true, errorMessage: message } : {};
}

const LoginPageContent = observer(function LoginPageContent() {
  const service = useService(LoginService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [errors, setErrors] = useState<FieldErrors>({});
  // 提交中态用本地 state：jsdom 下 RAB 属性变更不触发 observer 重渲（见
  // settings-account.test.tsx 约定），loading 必须可从 DOM 断言；请求本身仍只走 service.submit。
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // loading 期间 Enter / 重复点击不二次提交
    const parsed = loginInputSchema.safeParse({ email: service.email, password: service.password });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email' && !next.email) next.email = '请输入正确的邮箱地址';
        if (issue.path[0] === 'password' && !next.password) next.password = '请输入密码';
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    void service
      .submit()
      .then(() => navigate(location.state?.from ?? '/', { replace: true }))
      .catch(() => undefined) // API 错误横幅读 $model.submit.error，不双写本地 state
      .finally(() => setSubmitting(false));
  }

  return (
    <AuthFrame title="登录时刻">
      <form onSubmit={onSubmit} className="flex flex-col gap-field-stack">
        <TextField
          label="邮箱"
          name="email"
          type="email"
          autoComplete="email"
          value={service.email}
          onChange={(v) => (service.email = v)}
          {...fieldValidation(errors.email)}
        />
        <PasswordField
          label="密码"
          name="password"
          autoComplete="current-password"
          value={service.password}
          onChange={(v) => (service.password = v)}
          {...fieldValidation(errors.password)}
        />
        {service.$model.submit.error && <Banner tone="error">{humanError(service.$model.submit.error)}</Banner>}
        <Button type="submit" className="w-full" loading={submitting}>
          {submitting ? '登录中…' : '登录'}
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
