import { Service } from '@rabjs/react';
import type { AggregateResponse, MomentResponse, TemplateManifest } from '@moment/dto';
import { client } from '@/api/client';

export type PublicShareChain = Awaited<ReturnType<typeof client.getPublicShare>>['chain'];

/** 公开分享相册（spec §4.5）：匿名只读分页。 */
export class ShareAlbumService extends Service {
  token = '';
  chain: PublicShareChain | null = null;
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  /** 模板 manifest 与聚合投影（spec §3.2：分享响应附带，长辈可见里程碑轴/地图/心情线）。
   *  响应里的 template key 不落字段——当前无 UI 消费者（评审 S10），需要调试时从 templateManifest 推断。 */
  templateManifest: TemplateManifest | null = null;
  aggregates: AggregateResponse[] = [];
  private loadingMore = false;

  hydrate(token: string): void {
    if (this.token === token) return;
    this.token = token;
    this.chain = null;
    this.moments = [];
    this.templateManifest = null;
    this.aggregates = [];
    void this.loadFirst();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadFirst(): Promise<void> {
    const page = await client.getPublicShare(this.token);
    this.chain = page.chain;
    this.templateManifest = page.templateManifest;
    this.aggregates = page.aggregates;
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const page = await client.getPublicShare(this.token, this.nextCursor);
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }
}
