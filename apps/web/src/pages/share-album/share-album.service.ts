import { Service } from '@rabjs/react';
import type { MomentResponse } from '@moment/dto';
import { client } from '@/api/client';

export type PublicShareChain = Awaited<ReturnType<typeof client.getPublicShare>>['chain'];

/** 公开分享相册（spec §4.5）：匿名只读分页。 */
export class ShareAlbumService extends Service {
  token = '';
  chain: PublicShareChain | null = null;
  moments: MomentResponse[] = [];
  nextCursor: string | null = null;
  private loadingMore = false;

  hydrate(token: string): void {
    if (this.token === token) return;
    this.token = token;
    this.chain = null;
    this.moments = [];
    void this.loadFirst();
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadFirst(): Promise<void> {
    const page = await client.getPublicShare(this.token);
    this.chain = page.chain;
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
