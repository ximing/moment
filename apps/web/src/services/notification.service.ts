import { Service } from '@rabjs/react';
import type { NotificationDto, UserProfile } from '@moment/dto';
import { client } from '@/api/client';
import { AuthService } from './auth.service';

const POLL_MS = 30_000;

/** 全局通知（spec §3.4）：Shell 未读数与通知页列表共享一份；轮询只 merge 不重置分页。 */
export class NotificationService extends Service {
  items: NotificationDto[] = [];
  nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    // 冷启动兜底（与 ChainListService 同理）
    if (this.resolve(AuthService).user) this.startPolling();
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user) this.startPolling();
        else this.stopPolling();
      },
      'global',
    );
  }

  /** 全局单例随应用存续：interval 靠 auth:changed 关，不进 destroy()（spec §5） */
  private startPolling(): void {
    if (this.timer) return;
    void this.loadFirst();
    this.timer = setInterval(() => void this.pollUnread(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.items = [];
    this.nextCursor = null;
    this.gen++;
  }

  get unreadCount(): number {
    return this.items.filter((n) => n.readAt === null).length;
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listNotifications(undefined, { limit: 50 });
    if (gen !== this.gen) return; // 过期响应丢弃
    this.items = page.notifications;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.listNotifications(undefined, { cursor: this.nextCursor, limit: 50 });
      if (gen !== this.gen) return;
      this.items = [...this.items, ...page.notifications];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  /** 30s 轮询专用（spec §3.4）：拉第一页 merge——新条目前置、已有条目按 id 换新（读态变化），
   *  不动 nextCursor、不丢用户已加载的分页。 */
  async pollUnread(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listNotifications(undefined, { limit: 50 });
    if (gen !== this.gen) return;
    const pageIds = new Set(page.notifications.map((n) => n.id));
    const older = this.items.filter((n) => !pageIds.has(n.id));
    this.items = [...page.notifications, ...older];
  }

  async markAllRead(): Promise<void> {
    const unreadIds: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listNotifications(undefined, { cursor, limit: 50 });
      unreadIds.push(...page.notifications.filter((n) => n.readAt === null).map((n) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    for (let i = 0; i < unreadIds.length; i += 100) {
      await client.markNotificationsRead(unreadIds.slice(i, i + 100));
    }
    await this.loadFirst(); // 直接重拉，不发自发自收的 notification:changed（spec §3.4）
  }
}
