import type { AcceptInviteResponse, UserProfile } from '@moment/dto';
import {
  Authorized,
  CurrentUser,
  Delete,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
} from 'routing-controllers';
import { Service } from 'typedi';
import { ChainService } from './chain.service.js';

@JsonController('/invites')
@Service()
@Authorized()
export class InvitesController {
  constructor(private chainService: ChainService) {}

  @Delete('/:inviteId')
  @HttpCode(204)
  @OnUndefined(204)
  revoke(@CurrentUser() user: UserProfile, @Param('inviteId') inviteId: string): Promise<void> {
    return this.chainService.revokeInvite(user.id, inviteId);
  }

  @Post('/:token/accept')
  accept(@CurrentUser() user: UserProfile, @Param('token') token: string): Promise<AcceptInviteResponse> {
    return this.chainService.acceptInvite(user, token);
  }
}
