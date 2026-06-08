import { useService } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 过渡 shim：接口与原 useAuth 一致，实现委托全局 AuthService（spec §3.1）。
 *  ⚠️ 返回的是 Service 实例，消费方未包 observer 时读 auth.user 不会触发重渲——
 *  未迁移页面（表单类，user 只作一次判空）可接受；Task 14 删本文件。 */
export function useAuth(): AuthService {
  return useService(AuthService);
}
