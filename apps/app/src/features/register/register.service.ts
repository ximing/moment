import { Service } from '@rabjs/react';
import { AuthService } from '../../services/auth.service';

/** 注册页：表单字段 + 调 auth.register；schema 校验与跳转留在组件。 */
export class RegisterService extends Service {
  email = '';
  password = '';
  nickname = '';

  async submit(): Promise<void> {
    await this.resolve(AuthService).register({
      email: this.email,
      password: this.password,
      nickname: this.nickname,
    });
  }
}
