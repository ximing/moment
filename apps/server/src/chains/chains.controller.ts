import {
  createChainInputSchema,
  createInviteInputSchema,
  reorderChainsInputSchema,
  transferChainInputSchema,
  updateChainInputSchema,
  updateMemberRoleInputSchema,
  type ChainDto,
  type ChainMemberDto,
  type InviteDto,
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
  Put,
  UseBefore,
  BadRequestError,
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

  // spec chain-ordering §5：全量重写我的链顺序，固定 204——客户端已持有完整顺序（乐观更新），不需要回读
  @Put('/order')
  @HttpCode(204)
  @OnUndefined(204)
  reorder(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<void> {
    return this.chainService.reorder(user.id, reorderChainsInputSchema.parse(body));
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
    // template 创建后不可改（spec §3.2/§8.3）：updateChainInputSchema 不含 template 键会被 zod 静默剥离，
    // 必须在 parse 前检测原始 body
    if (body !== null && typeof body === 'object' && 'template' in body) {
      throw new BadRequestError('TEMPLATE_IMMUTABLE');
    }
    return this.chainService.update(user.id, chainId, updateChainInputSchema.parse(body));
  }

  @Delete('/:chainId')
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('owner'))
  remove(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<void> {
    return this.chainService.remove(user.id, chainId);
  }

  @Get('/:chainId/members')
  @UseBefore(requireChainRole('viewer'))
  listMembers(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<ChainMemberDto[]> {
    return this.chainService.listMembers(user.id, chainId);
  }

  @Patch('/:chainId/members/:userId')
  @UseBefore(requireChainRole('owner'))
  updateMemberRole(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Param('userId') targetUserId: string,
    @Body() body: unknown
  ): Promise<ChainMemberDto> {
    return this.chainService.updateMemberRole(
      user.id,
      chainId,
      targetUserId,
      updateMemberRoleInputSchema.parse(body).role
    );
  }

  @Delete('/:chainId/members/:userId')
  @HttpCode(204)
  @OnUndefined(204)
  @UseBefore(requireChainRole('viewer'))
  removeMember(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Param('userId') targetUserId: string
  ): Promise<void> {
    // viewer 中间件只挡非成员（404）；「本人退链 vs owner 移除他人」的分支裁决在 service 内经 ChainPolicy 完成
    return this.chainService.removeMember(user.id, chainId, targetUserId);
  }

  @Post('/:chainId/transfer')
  @UseBefore(requireChainRole('owner'))
  transfer(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<ChainDto> {
    return this.chainService.transfer(user.id, chainId, transferChainInputSchema.parse(body).userId);
  }

  @Post('/:chainId/invites')
  @HttpCode(201)
  @UseBefore(requireChainRole('editor'))
  createInvite(
    @CurrentUser() user: UserProfile,
    @Param('chainId') chainId: string,
    @Body() body: unknown
  ): Promise<InviteDto> {
    return this.chainService.createInvite(user.id, chainId, createInviteInputSchema.parse(body));
  }

  @Get('/:chainId/invites')
  @UseBefore(requireChainRole('owner'))
  listInvites(@CurrentUser() user: UserProfile, @Param('chainId') chainId: string): Promise<InviteDto[]> {
    return this.chainService.listInvites(user.id, chainId);
  }
}
