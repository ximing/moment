import { publicShareQuerySchema, type PublicShareResponse } from '@moment/dto';
import { Get, JsonController, Param, QueryParam } from 'routing-controllers';
import { Service } from 'typedi';
import { ShareLinkService } from './share-link.service.js';

/** 匿名公开端点（spec §4 Public）：不挂 @Authorized，无任何写操作。 */
@JsonController('/public')
@Service()
export class PublicShareController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Get('/share/:token')
  getShared(
    @Param('token') token: string,
    @QueryParam('cursor', { required: false, type: String }) cursor: string | undefined,
    @QueryParam('limit', { required: false, type: String }) limit: string | undefined
  ): Promise<PublicShareResponse> {
    return this.shareLinks.getSharedChain(token, publicShareQuerySchema.parse({ cursor, limit }));
  }
}
