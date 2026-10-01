import { createAgentThreadInputSchema, type UserProfile } from '@moment/dto';
import { Authorized, Body, CurrentUser, Delete, Get, HttpCode, JsonController, OnUndefined, Param, Post } from 'routing-controllers';
import { Service } from 'typedi';
import { AgentService } from './agent.service.js';

@JsonController('/agent/threads')
@Service()
@Authorized()
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('/')
  @HttpCode(201)
  create(@CurrentUser() user: UserProfile, @Body() body: unknown): ReturnType<AgentService['create']> {
    createAgentThreadInputSchema.parse(body);
    return this.agent.create(user.id);
  }

  @Get('/')
  list(@CurrentUser() user: UserProfile): ReturnType<AgentService['list']> {
    return this.agent.list(user.id);
  }

  @Get('/:id')
  get(@CurrentUser() user: UserProfile, @Param('id') id: string): ReturnType<AgentService['get']> {
    return this.agent.get(user.id, id);
  }

  @Delete('/:id')
  @HttpCode(204)
  @OnUndefined(204)
  remove(@CurrentUser() user: UserProfile, @Param('id') id: string): Promise<void> {
    return this.agent.remove(user.id, id);
  }
}
