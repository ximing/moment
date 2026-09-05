import { register } from '@rabjs/react';
import { AppUpdateService } from './app-update.service';
import { AuthService } from './auth.service';
import { ChainListService } from './chain-list.service';
import { NotificationService } from './notification.service';

let registered = false;

/** 全局 Service 注册（AuthService 恒排首——后续 Service 构造里 resolve(AuthService)）。
 *  模块级 once-guard：Fast Refresh 重执行不重复注册。 */
export function registerGlobals(): void {
  if (registered) return;
  registered = true;
  register(AuthService);
  register(ChainListService);
  register(NotificationService);
  register(AppUpdateService);
}
