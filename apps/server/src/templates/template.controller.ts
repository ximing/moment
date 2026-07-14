import {
  createTemplateInputSchema,
  templateScopeSchema,
  updateTemplateInputSchema,
  type TemplateDto,
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
  QueryParam,
} from 'routing-controllers';
import { Service } from 'typedi';
import { z } from 'zod';
import { TemplateService } from './template.service.js';

const listQuerySchema = z.object({ scope: templateScopeSchema.optional() });

@JsonController('/templates')
@Service()
@Authorized()
export class TemplatesController {
  constructor(private templateService: TemplateService) {}

  @Get('/')
  list(@CurrentUser() user: UserProfile, @QueryParam('scope') scope?: string): Promise<TemplateDto[]> {
    return this.templateService.list(user.id, listQuerySchema.parse({ scope }).scope);
  }

  @Post('/')
  @HttpCode(201)
  create(@CurrentUser() user: UserProfile, @Body() body: unknown): Promise<TemplateDto> {
    return this.templateService.create(user.id, createTemplateInputSchema.parse(body));
  }

  @Get('/:key')
  getOne(@Param('key') key: string): Promise<TemplateDto> {
    return this.templateService.getByKey(key);
  }

  @Patch('/:key')
  update(
    @CurrentUser() user: UserProfile,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<TemplateDto> {
    return this.templateService.update(user.id, key, updateTemplateInputSchema.parse(body));
  }

  @Delete('/:key')
  @HttpCode(204)
  @OnUndefined(204)
  archive(@CurrentUser() user: UserProfile, @Param('key') key: string): Promise<void> {
    return this.templateService.archive(user.id, key);
  }
}
