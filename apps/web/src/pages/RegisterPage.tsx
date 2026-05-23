import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '@moment/api-client';
import { registerInputSchema } from '@moment/dto';
import { useAuth } from '@/auth/AuthProvider';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  // 与 LoginPage 同款回跳：未登录点邀请链接被踢到 /login → 点「注册」进来后 from 不丢，
  // 注册成功自动回到邀请页（spec：未注册邮箱先收链接，注册后自动入链）。
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setFieldErrors({ confirm: '两次输入的密码不一致' });
      return;
    }
    const parsed = registerInputSchema.safeParse({ email, password, nickname });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register(parsed.data);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    type: string
  ) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-gray-600">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => setter(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none"
      />
      {fieldErrors[id] && <p className="mt-1 text-xs text-red-600">{fieldErrors[id]}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold">注册时刻</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {field('email', '邮箱', email, setEmail, 'email')}
        {field('nickname', '昵称', nickname, setNickname, 'text')}
        {field('password', '密码（8–72 位）', password, setPassword, 'password')}
        {field('confirm', '确认密码', confirm, setConfirm, 'password')}
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-gray-900 py-2 text-white disabled:opacity-50"
        >
          {submitting ? '注册中…' : '注册'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-500">
        已有账号？<Link to="/login" state={location.state} className="text-gray-900 underline">登录</Link>
      </p>
    </div>
  );
}
