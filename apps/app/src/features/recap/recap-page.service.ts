import { Service } from '@rabjs/react';
import type { MomentResponse, RecapDto } from '@moment/dto';
import { client } from '../../lib/api';

/**
 * recap 详情页 Service（spec §7：Markdown 正文 + 高光时刻区）。
 * 页面级 Service（bindServices 注入）。
 * hydrate(chainId, period) 幂等挡双调用，reset 后拉取 recap + 高光 moments。
 */
export class RecapPageService extends Service {
  chainId = '';
  period = '';
  recap: RecapDto | null = null;
  highlights: MomentResponse[] = [];

  hydrate(chainId: string, period: string): void {
    if (this.chainId === chainId && this.period === period) return;
    this.chainId = chainId;
    this.period = period;
    this.recap = null;
    this.highlights = [];
    void this.load().catch(() => undefined);
  }

  async load(): Promise<void> {
    const recap = await client.getRecap(this.chainId, this.period);
    if (recap.chainId !== this.chainId || recap.period !== this.period) return; // 过期响应丢弃
    this.recap = recap;
    const moments = await Promise.all(
      recap.highlights.map((id) => client.getMoment(id).catch(() => null)),
    );
    this.highlights = moments.filter((m): m is MomentResponse => m !== null);
  }
}
