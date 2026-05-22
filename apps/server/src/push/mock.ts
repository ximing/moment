import type { PushMessage, PushSendOutcome, PushService } from './push-service.js';

/** 测试/本地开发用 mock：记录消息、可配置失效 token 与抛错。 */
export class MockPushService implements PushService {
  readonly sent: PushMessage[] = [];
  invalidTokensToReport: string[] = [];
  failWith?: Error;

  async send(messages: PushMessage[]): Promise<PushSendOutcome> {
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return { invalidTokens: [...this.invalidTokensToReport] };
  }
}
