import { chainJobsQuerySchema, type ChainJobListResponse } from '@moment/dto';
import type { Request } from 'express';
import { Authorized, Get, JsonController, Param, Req, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js';
import { JobsService } from './jobs.service.js';

/** 链内嵌套路由（CONVENTIONS §3.1）；仅 owner（spec fused-retrieval §6.4） */
@JsonController('/chains/:chainId/jobs')
@Service()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('/')
  @Authorized()
  @UseBefore(requireChainRole('owner'))
  list(@Param('chainId') chainId: string, @Req() req: Request): Promise<ChainJobListResponse> {
    const query = chainJobsQuerySchema.parse(req.query);
    return this.jobsService.list(chainId, query);
  }
}
