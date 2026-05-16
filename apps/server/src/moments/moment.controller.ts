import type { MomentResponse, UserProfile } from '@moment/dto';
import { createMomentInputSchema } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  HttpCode,
  JsonController,
  Param,
  Post,
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
}
