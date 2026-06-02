import {
  createShareLinkInputSchema,
  type ShareLinkDto,
  type ShareLinkListResponse,
  type UserProfile,
} from '@moment/dto';
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
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { ShareLinkService } from './share-link.service.js';

@JsonController('/chains/:chainId/share-links')
@Service()
export class ShareLinksController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Post('/')
  @Authorized()
  @UseBefore(requireChainRole('owner'))
  @HttpCode(201)
  create(
    @Param('chainId') chainId: string,
    @CurrentUser() user: UserProfile,
    @Body() body: unknown
  ): Promise<ShareLinkDto> {
    return this.shareLinks.create(user.id, chainId, createShareLinkInputSchema.parse(body));
  }

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('owner'))
  list(@Param('chainId') chainId: string): Promise<ShareLinkListResponse> {
    return this.shareLinks.list(chainId);
  }
}

@JsonController('/share-links')
@Service()
export class ShareLinkItemController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Delete('/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.shareLinks.revoke(user.id, id);
  }
}
