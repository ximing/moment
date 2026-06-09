import { Service } from '@rabjs/react';
import { AuthService } from '@/services/auth.service';

/** 注册页（spec §4.5）：表单字段 + 调 auth.register；两次密码一致与 schema 校验留在组件。 */
export class RegisterService extends Service {
  email = '';
  nickname = '';
  password = '';
  confirm = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).register({
      email: this.email,
      password: this.password,
      nickname: this.nickname,
    });
  }
}
