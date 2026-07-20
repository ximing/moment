import { periodSchema, type RecapDto, type RecapListResponse } from '@moment/dto';
import { Authorized, BadRequestError, Get, HttpCode, JsonController, OnUndefined, Param, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { RecapService } from './recap.service.js';

/** 链内嵌套路由（CONVENTIONS §3.1：链内资源一律嵌套） */
@JsonController('/chains/:chainId/recaps')
@Service()
export class RecapController {
  constructor(private readonly recapService: RecapService) {}

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(@Param('chainId') chainId: string): Promise<RecapListResponse> {
    return this.recapService.list(chainId);
  }

  @Get('/:period')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  async getByPeriod(@Param('chainId') chainId: string, @Param('period') period: string): Promise<RecapDto> {
    const parsed = periodSchema.safeParse(period);
    if (!parsed.success) throw new BadRequestError('INVALID_PERIOD');
    return this.recapService.getByPeriod(chainId, parsed.data);
  }

  @Post('/:period/regenerate')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  @HttpCode(202)
  @OnUndefined(202)
  async regenerate(@Param('chainId') chainId: string, @Param('period') period: string): Promise<void> {
    const parsed = periodSchema.safeParse(period);
    if (!parsed.success) throw new BadRequestError('INVALID_PERIOD');
    await this.recapService.regenerate(chainId, parsed.data);
  }
}
