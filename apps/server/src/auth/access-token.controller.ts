import {
  createAccessTokenInputSchema,
  type AccessTokenList,
  type CreatedAccessToken,
  type UserProfile,
} from "@moment/dto";
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
} from "routing-controllers";
import { Service } from "typedi";
import { AccessTokenService } from "./access-token.service.js";

@JsonController("/auth/tokens")
@Service()
export class AccessTokenController {
  constructor(private tokens: AccessTokenService) {}

  @Get("/")
  @Authorized()
  list(@CurrentUser() user: UserProfile): Promise<AccessTokenList> {
    return this.tokens.list(user.id);
  }

  /** 明文只在这一次响应里返回。之后列表只有 preview。 */
  @Post("/")
  @HttpCode(201)
  @Authorized()
  create(
    @CurrentUser() user: UserProfile,
    @Body() body: unknown,
  ): Promise<CreatedAccessToken> {
    return this.tokens.create(
      user.id,
      createAccessTokenInputSchema.parse(body),
    );
  }

  @Delete("/:id")
  @HttpCode(204)
  @OnUndefined(204)
  @Authorized()
  revoke(
    @CurrentUser() user: UserProfile,
    @Param("id") id: string,
  ): Promise<void> {
    return this.tokens.revoke(user.id, id);
  }
}
