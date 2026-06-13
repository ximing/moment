import { Service } from '@rabjs/react';
import type { NotificationDto, UserProfile } from '@moment/dto';
import { client } from '../lib/api';
import { AuthService } from './auth.service';

const POLL_MS = 30_000;

/** 全局通知：通知页列表与未读数共享一份；轮询只 merge 不重置分页。 */
export class NotificationService extends Service {
  items: NotificationDto[] = [];
  nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
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

  /** 全局单例随应用存续：interval 靠 auth:changed 关，不进 destroy()（生命周期靠 GC，时机不可控）。 */
  private startPolling(): void {
    if (this.timer) return;
    void this.loadFirst().catch(() => undefined);
    this.timer = setInterval(() => void this.pollUnread().catch(() => undefined), POLL_MS);
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

  /** 30s 轮询：拉第一页 merge——新条目前置、已有条目按 id 换新（读态变化），不动 nextCursor。 */
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
    // schema 限每批 1–100 个：分批串行提交；空 ids 跳过 POST（schema 拒空数组）
    for (let i = 0; i < unreadIds.length; i += 100) {
      const chunk = unreadIds.slice(i, i + 100);
      if (chunk.length === 0) continue;
      await client.markNotificationsRead(chunk);
    }
    await this.loadFirst(); // 直接重拉，不发自发自收的 notification:changed
  }

  /** 点单条已读（跳转前调）。 */
  async markOneRead(id: string): Promise<void> {
    await client.markNotificationsRead([id]);
    await this.loadFirst();
  }
}
