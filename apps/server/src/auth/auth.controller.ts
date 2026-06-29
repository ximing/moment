import {
  changePasswordInputSchema,
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  updateMeInputSchema,
  type AuthResponse,
  type UserProfile,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Patch,
  Post,
} from 'routing-controllers';
import { Service } from 'typedi';
import { AuthService } from './auth.service.js';

@JsonController('/auth')
@Service()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('/register')
  @HttpCode(201)
  register(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.register(registerInputSchema.parse(body));
  }

  @Post('/login')
  login(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.login(loginInputSchema.parse(body));
  }

  @Post('/refresh')
  refresh(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.refresh(refreshInputSchema.parse(body).refreshToken);
  }

  @Post('/logout')
  @HttpCode(204)
  @OnUndefined(204)
  logout(@Body() body: unknown): Promise<void> {
    return this.auth.logout(refreshInputSchema.parse(body).refreshToken);
  }

  @Get('/me')
  @Authorized()
  me(@CurrentUser() user: UserProfile): Promise<UserProfile> {
    return this.auth.getProfile(user.id);
  }

  @Patch('/me')
  @Authorized()
  updateMe(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<UserProfile> {
    return this.auth.updateMe(user.id, updateMeInputSchema.parse(body));
  }

  /** 改密即全端下线：passwordChangedAt 使旧 access token 失效 + 吊销全部 refresh token。 */
  @Post('/change-password')
  @HttpCode(204)
  @OnUndefined(204)
  @Authorized()
  changePassword(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<void> {
    return this.auth.changePassword(user.id, changePasswordInputSchema.parse(body));
  }
}
