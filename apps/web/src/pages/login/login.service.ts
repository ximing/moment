import { Service } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 登录页（spec §4.5）：表单字段 + 调 auth.login；schema 校验与跳转留在组件。 */
export class LoginService extends Service {
  email = '';
  password = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).login({ email: this.email, password: this.password });
  }
}
