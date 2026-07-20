import { Service } from '@rabjs/react';
import type { RecapDto } from '@moment/dto';
import { client } from '@/api/client';

/**
 * recap 入口条 Service（spec §7：存在最近一期 ready/degraded 回顾时渲染）。
 * 页面级 Service（bindServices 注入），非全局——只在链主页使用。
 * 失败降级：latest 保持 null → 入口条不渲染，不阻塞链主页。
 */
export class RecapEntryService extends Service {
  chainId = '';
  latest: RecapDto | null = null;

  /** 链主页 hydrate 时调用；幂等挡双调用。 */
  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.latest = null;
    void this.load().catch(() => undefined); // 错误静默：入口条不渲染
  }

  async load(): Promise<void> {
    const res = await client.listRecaps(this.chainId);
    // period 倒序，取第一条；仅 ready/degraded 显示（generating/failed 不显示）
    const first = res.recaps[0];
    if (!first) return;
    if (first.status === 'ready' || first.status === 'degraded') {
      this.latest = first;
    }
  }
}
