import {
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
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
  me(@CurrentUser() user: UserProfile): UserProfile {
    return user;
  }
}
