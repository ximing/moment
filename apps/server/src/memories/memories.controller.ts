import { memoriesTodayQuerySchema, type MemoriesTodayResponse, type UserProfile } from '@moment/dto';
import type { Request } from 'express';
import { Authorized, BadRequestError, CurrentUser, Get, JsonController, Req } from 'routing-controllers';
import { Service } from 'typedi';
import { MemoriesService } from './memories.service.js';

@JsonController()
@Service()
export class MemoriesController {
  constructor(private memoriesService: MemoriesService) {}

  @Get('/memories/today')
  @Authorized()
  today(@Req() req: Request, @CurrentUser() user: UserProfile): Promise<MemoriesTodayResponse> {
    // spec §2：date 非法 → INVALID_DATE（业务机器码），不走 ZodError 的 VALIDATION_ERROR 兜底
    const parsed = memoriesTodayQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new BadRequestError('INVALID_DATE');
    return this.memoriesService.today(user.id, parsed.data.date);
  }
}
