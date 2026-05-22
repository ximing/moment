import type { MomentListResponse, MomentResponse, UserProfile } from '@moment/dto';
import { createMomentInputSchema, listMomentsQuerySchema, patchMomentInputSchema } from '@moment/dto';
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
  Patch,
  Post,
  QueryParam,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { MomentService } from './moment.service.js';

/** 链内嵌套路由（CONVENTIONS §3.1：链内资源一律嵌套） */
@JsonController('/chains/:chainId/moments')
@Service()
export class MomentController {
  constructor(private readonly momentService: MomentService) {}

  @Post('/')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  @HttpCode(201)
  create(
    @Param('chainId') chainId: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MomentResponse> {
    return this.momentService.create(user.id, chainId, createMomentInputSchema.parse(body));
  }

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(
    @Param('chainId') chainId: string,
    @QueryParam('cursor', { required: false, type: String }) cursor: string | undefined,
    @QueryParam('limit', { required: false, type: String }) limit: string | undefined,
    @CurrentUser() user: UserProfile
  ): Promise<MomentListResponse> {
    const query = listMomentsQuerySchema.parse({ cursor, limit });
    return this.momentService.list(user.id, chainId, query);
  }
}

/** 按资源 id 反查链的读/写接口：service 层调 ChainPolicy.require（CONVENTIONS §3.1） */
@JsonController('/moments')
@Service()
export class MomentItemController {
  constructor(private readonly momentService: MomentService) {}

  @Get('/:id')
  @Authorized()
  get(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<MomentResponse> {
    return this.momentService.get(user.id, id);
  }

  @Patch('/:id')
  @Authorized()
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MomentResponse> {
    return this.momentService.update(user.id, id, patchMomentInputSchema.parse(body));
  }

  @Delete('/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.momentService.remove(user.id, id);
  }
}
