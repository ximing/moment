import { Service } from '@rabjs/react';
import type { ChainDto, ChainMemberDto, InviteDto, MomentResponse, TagResponse } from '@moment/dto';
import { client } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { qk } from '../../lib/keys';
import type { ChainChangedPayload } from '../../lib/events';

export type ChainSegment = 'timeline' | 'members' | 'invites' | 'tags';

/** 链详情（本 Task 保持全功能四段；Task 9 上线设置页后收薄为 timeline + tags）。 */
export class ChainHomeService extends Service {
  chainId = '';
  chain: ChainDto | null = null;
  segment: ChainSegment = 'timeline';
  moments: MomentResponse[] = [];
  members: ChainMemberDto[] = [];
  invites: InviteDto[] = [];
  tags: TagResponse[] = [];
  private nextCursor: string | null = null;
  private gen = 0;
  private loadingMore = false;
  private sectionsLoaded = false;

  constructor() {
    super();
    this.on(
      'moment:changed',
      () => {
        void this.loadFirst().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'comment:changed',
      () => {
        void this.loadFirst().catch(() => undefined);
      },
      'global',
    );
    this.on(
      'chain:changed',
      (p: ChainChangedPayload) => {
        if (p.chainId !== this.chainId) return;
        if (p.op === 'delete') return; // 删除后由用户导航离开
        void this.loadChain().catch(() => undefined);
      },
      'global',
    );
  }

  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    this.chain = null;
    this.moments = [];
    this.members = [];
    this.invites = [];
    this.tags = [];
    this.sectionsLoaded = false;
    void this.loadChain().catch(() => undefined);
    void this.loadFirst().catch(() => undefined);
  }

  get hasMore(): boolean {
    return this.nextCursor !== null;
  }

  get myRole(): string | undefined {
    // 优先 chain.myRole（getChain 实时）；兜底全局链列表
    return this.chain?.myRole;
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.sectionsLoaded) {
      this.sectionsLoaded = true;
      void this.loadMembers().catch(() => undefined);
      void this.loadTags().catch(() => undefined);
    }
  }

  async loadFirst(): Promise<void> {
    const gen = ++this.gen;
    const page = await client.listChainMoments(this.chainId, { cursor: undefined, limit: 20 });
    if (gen !== this.gen) return;
    this.moments = page.moments;
    this.nextCursor = page.nextCursor ?? null;
  }

  async loadMore(): Promise<void> {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    const gen = this.gen;
    try {
      const page = await client.listChainMoments(this.chainId, { cursor: this.nextCursor, limit: 20 });
      if (gen !== this.gen) return;
      this.moments = [...this.moments, ...page.moments];
      this.nextCursor = page.nextCursor ?? null;
    } finally {
      this.loadingMore = false;
    }
  }

  async loadMembers(): Promise<void> {
    this.members = await client.listMembers(this.chainId);
    // listInvites 仅 owner（editor 调会 403；这是服务端权限事实）
    if (this.chain?.myRole === 'owner') {
      this.invites = await client.listInvites(this.chainId);
    } else {
      this.invites = [];
    }
  }

  async loadTags(): Promise<void> {
    this.tags = (await client.listTags(this.chainId)).tags;
  }

  async changeRole(userId: string, role: 'editor' | 'viewer'): Promise<void> {
    await client.updateMemberRole(this.chainId, userId, role);
    await this.loadMembers();
  }

  async removeMember(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    await this.loadMembers();
    await this.loadChain();
  }

  async createInvite(role: 'editor' | 'viewer'): Promise<string> {
    const invite = await client.createInvite(this.chainId, { role });
    await this.loadMembers();
    return invite.token; // 组件拼 moment://invites/<token> 走 Share
  }

  async revokeInvite(id: string): Promise<void> {
    await client.revokeInvite(id);
    await this.loadMembers();
  }

  async addTag(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await client.createTag(this.chainId, trimmed);
    await this.loadTags();
    void queryClient.invalidateQueries({ queryKey: qk.tags(this.chainId) }); // 过渡期；Task 11 删
  }

  async deleteTag(id: string): Promise<void> {
    await client.deleteTag(id);
    await this.loadTags();
    void queryClient.invalidateQueries({ queryKey: qk.tags(this.chainId) }); // 过渡期；Task 11 删
  }
}
