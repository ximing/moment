import { aggregateQuerySchema, type AggregateResponse } from '@moment/dto';
import { Authorized, Get, JsonController, NotFoundError, Param, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { eq } from 'drizzle-orm';
import { requireChainRole } from '../chains/require-chain-role.js';
import { db } from '../db/index.js';
import { chains } from '../db/schema.js';
import { AggregateService } from './aggregate.service.js';
import { TemplateService } from './template.service.js';

@JsonController('/chains')
@Service()
@Authorized()
export class AggregateController {
  constructor(
    private readonly aggregates: AggregateService,
    private readonly templates: TemplateService,
  ) {}

  /** 聚合视图投影（spec §3.2）：viewer 可读（成员资格由中间件保证，无需 CurrentUser）；archived 模板的存量链照常（getByKey 任意 status）。 */
  @Get('/:chainId/aggregate')
  @UseBefore(requireChainRole('viewer'))
  async aggregate(
    @Param('chainId') chainId: string,
    @QueryParams() query: unknown,
  ): Promise<AggregateResponse> {
    const q = aggregateQuerySchema.parse(query);
    const [chain] = await db.select({ template: chains.template }).from(chains).where(eq(chains.id, chainId)).limit(1);
    if (!chain) throw new NotFoundError('CHAIN_NOT_FOUND'); // 中间件已保证成员资格，防御性兜底
    const manifest = (await this.templates.getByKey(chain.template)).manifest;
    return this.aggregates.project(chainId, manifest, q);
  }
}
