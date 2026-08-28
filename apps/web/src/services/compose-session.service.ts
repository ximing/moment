import { Service } from '@rabjs/react';
import type { PublicShareMoment } from '@moment/dto';

export interface ComposeRequest {
  chainId?: string;
  edit?: PublicShareMoment;
}

/** 全局发布面板会话（spec §3.5）：FAB / 入口卡 / ?compose=1 / 生长动画共用。 */
export class ComposeSessionService extends Service {
  request: ComposeRequest | null = null;
  /** 发布成功的 moment id：时间线「从链节长出来」微动效（spec §1.6）。渲染期直读，不用 ref。 */
  lastCreatedId: string | null = null;

  openCompose(req?: ComposeRequest): void {
    // 下一次打开发布面板即自清，生长动画只作用于刚发布的那张卡
    this.lastCreatedId = null;
    this.request = req ?? {};
  }

  closeCompose(): void {
    this.request = null;
  }

  markCreated(id: string): void {
    this.lastCreatedId = id;
  }
}
