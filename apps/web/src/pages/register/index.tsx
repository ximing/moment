import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { registerInputSchema } from '@moment/dto';
import { humanError } from '@/lib/errors';
import { AuthFrame } from '@/pages/auth-frame';
// 必须显式指向 barrel 文件：src/ui/ 下同名遗留文件（Button.tsx / Banner.tsx /
// Field.tsx）在本 Task 删除前，大小写不敏感文件系统上裸目录导入会被截获。
import { Button } from '@/ui/button/index';
import { Banner } from '@/ui/feedback/index';
import { PasswordField, TextField } from '@/ui/field/index';
import { RegisterService } from './register.service';

type FieldErrors = { email?: string; nickname?: string; password?: string; confirm?: string };

/** isInvalid 与 errorMessage 成对出现（Field 规范 §8）：返回联合类型让展开保持可分配。 */
function fieldValidation(
  message: string | undefined,
): { isInvalid: true; errorMessage: string } | { isInvalid?: false; errorMessage?: undefined } {
  return message ? { isInvalid: true, errorMessage: message } : {};
}

const RegisterPageContent = observer(function RegisterPageContent() {
  const service = useService(RegisterService);
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [errors, setErrors] = useState<FieldErrors>({});
  // 提交中态用本地 state：jsdom 下 RAB 属性变更不触发 observer 重渲（见
  // settings-account.test.tsx 约定），loading 必须可从 DOM 断言；请求本身仍只走 service.submit。
  const [submitting, setSubmitting] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // loading 期间 Enter / 重复点击不二次提交
    if (service.password !== service.confirm) {
      setErrors({ confirm: '两次密码不一致' });
      return;
    }
    const parsed = registerInputSchema.safeParse({
      email: service.email,
      password: service.password,
      nickname: service.nickname,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && !next.email) next.email = '请输入正确的邮箱地址';
        if (key === 'nickname' && !next.nickname) next.nickname = '请输入名字';
        if (key === 'password' && !next.password) next.password = '密码至少 8 位';
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
    <AuthFrame title="加入时刻">
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
        <TextField
          label="你的名字"
          name="nickname"
          autoComplete="name"
          value={service.nickname}
          onChange={(v) => (service.nickname = v)}
          {...fieldValidation(errors.nickname)}
        />
        <PasswordField
          label="密码"
          name="password"
          autoComplete="new-password"
          value={service.password}
          onChange={(v) => (service.password = v)}
          {...fieldValidation(errors.password)}
        />
        <PasswordField
          label="再输一遍密码"
          name="confirm"
          autoComplete="new-password"
          value={service.confirm}
          onChange={(v) => (service.confirm = v)}
          {...fieldValidation(errors.confirm)}
        />
        {service.$model.submit.error && <Banner tone="error">{humanError(service.$model.submit.error)}</Banner>}
        <Button type="submit" className="w-full" loading={submitting}>
          {submitting ? '注册中…' : '注册'}
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
