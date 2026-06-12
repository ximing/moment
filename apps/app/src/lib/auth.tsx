import { useEffect, useState } from 'react';
import { useService } from '@rabjs/react';
import type { RegisterInput, UserProfile } from '@moment/dto';
import { AuthService } from '../services/auth.service';

interface AuthContextValue {
  user: UserProfile | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}

/** 过渡 shim（Task 11 删）：给还没迁到 observer 的旧组件用。
 *  快照语义：auth:changed / ready 翻转（hydrate 完成也发事件）触发重渲染。 */
export function useAuth(): AuthContextValue {
  const auth = useService(AuthService);
  const [, setTick] = useState(0);
  useEffect(() => {
    // 注：rabjs 的 Service.on() 返回 this（Service 实例）而非退订函数，不能直接当 effect 清理；
    // 这里用 on/off 配对退订（快照语义与 brief Step 8 一致）。
    const handler = (): void => setTick((t) => t + 1);
    auth.on('auth:changed', handler, 'global');
    return () => {
      auth.off('auth:changed', handler, 'global');
    };
  }, [auth]);
  return {
    user: auth.user,
    ready: auth.ready,
    login: (email, password) => auth.login({ email, password }),
    register: (input) => auth.register(input),
    logout: () => auth.logout(),
  };
}
