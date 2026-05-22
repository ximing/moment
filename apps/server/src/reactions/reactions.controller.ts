import { reactionInputSchema, type UserProfile } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Put,
  Delete,
} from 'routing-controllers';
import { Service } from 'typedi';
import { ReactionService } from './reaction.service.js';

@JsonController()
@Service()
export class ReactionsController {
  constructor(private readonly reactionService: ReactionService) {}

  @Put('/moments/:id/reaction')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  set(@Param('id') momentId: string, @Body() body: unknown, @CurrentUser() user: UserProfile): Promise<void> {
    return this.reactionService.set(user.id, momentId, reactionInputSchema.parse(body));
  }

  @Delete('/moments/:id/reaction')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') momentId: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.reactionService.remove(user.id, momentId);
  }
}
