import { personCreateInputSchema, personPatchInputSchema, type PersonListResponse, type PersonResponse } from '@moment/dto';
import type { Response } from 'express';
import {
  Authorized,
  Body,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Params,
  Patch,
  Post,
  Res,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { requireChainRole } from '../chains/require-chain-role.js'; // 0.11 中 @UseBefore 先于 @Authorized 执行（同 tag.controller.ts）
import { PersonService } from './person.service.js';

@JsonController()
@Service()
export class PersonController {
  constructor(private personService: PersonService) {}

  @Get('/chains/:chainId/persons')
  @Authorized()
  @UseBefore(requireChainRole('viewer'))
  list(@Params() params: { chainId: string }): Promise<PersonListResponse> {
    return this.personService.list(params.chainId);
  }

  /**
   * 幂等创建（spec §6）：新建 201；名归一化撞 uk_persons_chain_name 返回已存在行 200。
   * 不用 @HttpCode 装饰器——它会在 routing-controllers 的 success handler 里无条件覆盖
   * 状态码；这里经 @Res 手动 set（无 @HttpCode 时框架不再改状态，返回值仍由框架
   * response.json() 发送，见 ExpressDriver.handleSuccess 源码行为，已在计划偏差 3 核实）。
   */
  @Post('/chains/:chainId/persons')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  async create(
    @Params() params: { chainId: string },
    @Body() body: unknown,
    @Res() res: Response
  ): Promise<PersonResponse> {
    const { person, created } = await this.personService.create(
      params.chainId,
      personCreateInputSchema.parse(body)
    );
    res.status(created ? 201 : 200);
    return person;
  }

  @Patch('/chains/:chainId/persons/:personId')
  @Authorized()
  @UseBefore(requireChainRole('editor'))
  rename(
    @Params() params: { chainId: string; personId: string },
    @Body() body: unknown
  ): Promise<PersonResponse> {
    return this.personService.rename(params.chainId, params.personId, personPatchInputSchema.parse(body));
  }

  @Delete('/chains/:chainId/persons/:personId')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('editor'))
  remove(@Params() params: { chainId: string; personId: string }): Promise<void> {
    return this.personService.remove(params.chainId, params.personId);
  }
}
