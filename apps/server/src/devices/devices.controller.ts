import { registerPushTokenSchema, type UserProfile } from '@moment/dto';
import { randomUUID } from 'node:crypto';
import { Authorized, Body, CurrentUser, HttpCode, JsonController, OnUndefined, Post } from 'routing-controllers';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { pushTokens } from '../db/schema.js';

@JsonController('/devices')
@Service()
export class DevicesController {
  /**
   * 注册/心跳：expo_token 全局唯一 upsert（同 token 换账号=重新绑定），每次刷新 last_seen_at。
   * 一条 INSERT ... ON DUPLICATE KEY UPDATE——先查后写在并发/双击重复注册时会撞唯一索引（500）。
   */
  @Post('/push-token')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  async register(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<void> {
    const input = registerPushTokenSchema.parse(body);
    await db
      .insert(pushTokens)
      .values({
        id: randomUUID(),
        userId: user.id,
        expoToken: input.expoToken,
        platform: input.platform,
        lastSeenAt: new Date(),
        invalidatedAt: null,
      })
      .onDuplicateKeyUpdate({
        set: { userId: user.id, platform: input.platform, lastSeenAt: new Date(), invalidatedAt: null },
      });
  }
}
