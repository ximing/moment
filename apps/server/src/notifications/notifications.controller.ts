import { markNotificationsReadSchema, type NotificationListResponse, type UserProfile } from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Post,
  QueryParam,
} from 'routing-controllers';
import { Service } from 'typedi';
import { NotificationService } from './notification.service.js';

@JsonController('/notifications')
@Service()
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('/')
  @Authorized()
  list(
    @CurrentUser() user: UserProfile,
    @QueryParam('unread', { required: false, type: String }) unread: string | undefined,
    @QueryParam('cursor', { required: false, type: String }) cursor: string | undefined,
    @QueryParam('limit', { required: false, type: String }) limit: string | undefined
  ): Promise<NotificationListResponse> {
    return this.notificationService.list(user.id, { unread, cursor, limit });
  }

  @Post('/read')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  markRead(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<void> {
    return this.notificationService.markRead(user.id, markNotificationsReadSchema.parse(body));
  }
}
