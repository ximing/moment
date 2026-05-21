import { tagCreateInputSchema, type TagListResponse, type TagResponse, type UserProfile } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Params,
  Post,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js'; // 0.11 中 @UseBefore 先于 @Authorized 执行：前置契约见「Phase 2/3 依赖契约」
import { TagService } from './tag.service.js';

@JsonController()
@Service()
export class TagController {
  constructor(private tagService: TagService) {}

  @Get('/chains/:chainId/tags')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(@Params() params: { chainId: string }): Promise<TagListResponse> {
    return this.tagService.list(params.chainId);
  }

  @Post('/chains/:chainId/tags')
  @Authorized()
  @HttpCode(201)
  @UseBefore(requireChainRole('editor'))
  create(@Params() params: { chainId: string }, @Body() body: unknown): Promise<TagResponse> {
    return this.tagService.create(params.chainId, tagCreateInputSchema.parse(body));
  }

  /** 非嵌套路由，chainId 由 service 反查，角色校验在 service 层 ChainPolicy（CONVENTIONS §3.1）。 */
  @Delete('/tags/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Params() params: { id: string }, @CurrentUser() user: UserProfile): Promise<void> {
    return this.tagService.remove(params.id, user.id);
  }
}
