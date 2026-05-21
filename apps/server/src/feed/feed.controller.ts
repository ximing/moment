import { feedQuerySchema, type FeedResponse, type UserProfile } from '@moment/dto';
import type { Request } from 'express';
import { Authorized, CurrentUser, Get, JsonController, Req } from 'routing-controllers';
import { Service } from 'typedi';
import { FeedService } from './feed.service.js';

@JsonController()
@Service()
export class FeedController {
  constructor(private feedService: FeedService) {}

  @Get('/feed')
  @Authorized()
  feed(@Req() req: Request, @CurrentUser() user: UserProfile): Promise<FeedResponse> {
    const query = feedQuerySchema.parse(req.query);
    return this.feedService.feed(user.id, {
      cursor: query.cursor,
      chainIds: query.chain_ids?.split(','),
      tagId: query.tag_id,
      order: query.order,
      limit: query.limit,
    });
  }
}
