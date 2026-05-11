import {
  createChainInputSchema,
  updateChainInputSchema,
  type ChainDto,
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
  Patch,
  Post,
  UseBefore,
} from 'routing-controllers';
import { Service } from 'typedi';
import { ChainService } from './chain.service.js';
import { requireChainRole } from './require-chain-role.js';

@JsonController('/chains')
@Service()
@Authorized()
export class ChainsController {
  constructor(private chainService: ChainService) {}

  @Post('/')
  @HttpCode(201)
  create(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<ChainDto> {
    return this.chainService.create(user.id, createChainInputSchema.parse(body));
  }

  @Get('/')
  list(@CurrentUser() user: UserProfile): Promise<ChainDto[]> {
    return this.chainService.listMine(user.id);
  }

  @Get('/:chainId')
  @UseBefore(requireChainRole('viewer'))
  getOne(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<ChainDto> {
    return this.chainService.getById(user.id, chainId);
  }

  @Patch('/:chainId')
  @UseBefore(requireChainRole('owner'))
  update(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<ChainDto> {
    return this.chainService.update(user.id, chainId, updateChainInputSchema.parse(body));
  }

  @Delete('/:chainId')
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('owner'))
  remove(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<void> {
    return this.chainService.remove(user.id, chainId);
  }
}
