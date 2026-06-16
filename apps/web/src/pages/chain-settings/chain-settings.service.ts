import { Service } from '@rabjs/react';
import type { ChainColor, ChainDto, ChainIcon, ShareLinkDto } from '@moment/dto';
import { client } from '@/api/client';
import { fallbackChainColor } from '@/lib/chain-color';
import type { ChainChangedPayload } from '@/lib/events';

/** 设置页全部状态（spec §4.5）：链详情 + 成员 + 邀请 + 分享链接 + 资料表单 + 标签。 */
export class ChainSettingsService extends Service {
  chainId = '';
  chain: ChainDto | null = null;

  members: Awaited<ReturnType<typeof client.listMembers>> = [];
  invites: Awaited<ReturnType<typeof client.listInvites>> = [];

  shareLinks: ShareLinkDto[] = [];
  shareExpire: 'never' | '7' | '30' | 'date' = 'never';
  shareDate = '';
  revokeLinkId: string | null = null;

  // 资料表单
  formName = '';
  formDescription = '';
  formColor: ChainColor = 'coral';
  formIcon: ChainIcon | null = null;
  formHydrated = false;
  tags: Awaited<ReturnType<typeof client.listTags>>['tags'] = [];
  newTagName = '';

  // 成员操作
  transferId: string | null = null;
  transferName = '';
  inviteEmail = '';

  constructor() {
    super();
    this.on(
      'chain:changed',
      (p: ChainChangedPayload) => {
        if (p.chainId !== this.chainId) return;
        if (p.op === 'delete') return; // 删除后页面即将跳走
        void this.loadChain().catch(() => undefined);
      },
      'global',
    );
  }

  hydrate(chainId: string): void {
    if (this.chainId === chainId) return;
    this.chainId = chainId;
    // 先拉链（角色决定成员/邀请/分享的可见面）；分区级联在 loadChain 成功路径里（首载失败后重试也能拉全）
    void this.loadChain().catch(() => undefined);
  }

  private sectionsLoaded = false;

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.sectionsLoaded) {
      // 链首次拉到后级联拉分区（角色决定可见面）；chain:changed 重拉不重复级联
      this.sectionsLoaded = true;
      void this.loadMembers().catch(() => undefined);
      void this.loadShareLinks().catch(() => undefined);
      void this.loadTags().catch(() => undefined);
    }
    if (!this.formHydrated && this.chain) {
      // 首载水合资料表单（之后用户改动不覆盖）
      this.formHydrated = true;
      this.formName = this.chain.name;
      this.formDescription = this.chain.description ?? '';
      this.formColor = this.chain.color ?? fallbackChainColor(this.chain.id);
      this.formIcon = this.chain.icon;
    }
  }

  async loadMembers(): Promise<void> {
    this.members = await client.listMembers(this.chainId);
    const myRole = this.chain?.myRole;
    if (myRole === 'owner' || myRole === 'editor') {
      this.invites = await client.listInvites(this.chainId);
    } else {
      this.invites = [];
    }
  }

  async loadShareLinks(): Promise<void> {
    if (!this.chain || this.chain.myRole !== 'owner') return;
    this.shareLinks = (await client.listShareLinks(this.chainId)).items;
  }

  async loadTags(): Promise<void> {
    this.tags = (await client.listTags(this.chainId)).tags;
  }

  async saveProfile(): Promise<void> {
    await client.updateChain(this.chainId, {
      name: this.formName.trim(),
      description: this.formDescription.trim() || null,
      color: this.formColor,
      icon: this.formIcon,
    });
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async createShareLink(): Promise<void> {
    let expiresAt: string | undefined;
    if (this.shareExpire === '7') expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
    if (this.shareExpire === '30') expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
    if (this.shareExpire === 'date' && this.shareDate) expiresAt = new Date(this.shareDate).toISOString();
    await client.createShareLink(this.chainId, expiresAt ? { expiresAt } : {});
    await this.loadShareLinks();
  }

  async revokeShareLink(id: string): Promise<void> {
    await client.revokeShareLink(id);
    this.revokeLinkId = null;
    await this.loadShareLinks();
  }

  async changeRole(userId: string, role: 'editor' | 'viewer'): Promise<void> {
    await client.updateMemberRole(this.chainId, userId, role);
    await this.loadMembers();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async removeMember(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    await this.loadMembers();
    await this.loadChain();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async leaveChain(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async transferChain(userId: string): Promise<void> {
    await client.transferChain(this.chainId, userId);
    this.transferId = null;
    this.transferName = '';
    await this.loadMembers();
    await this.loadChain();
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async createInvite(): Promise<void> {
    await client.createInvite(this.chainId, { email: this.inviteEmail.trim() || undefined, role: 'editor' });
    this.inviteEmail = '';
    await this.loadMembers();
  }

  async revokeInvite(id: string): Promise<void> {
    await client.revokeInvite(id);
    await this.loadMembers();
  }

  async addTag(): Promise<void> {
    const name = this.newTagName.trim();
    if (!name) return;
    await client.createTag(this.chainId, name);
    this.newTagName = '';
    await this.loadTags();
  }

  async deleteTag(id: string): Promise<void> {
    await client.deleteTag(id);
    await this.loadTags();
  }

  async deleteChain(): Promise<void> {
    await client.deleteChain(this.chainId);
    this.emit('chain:changed', { chainId: this.chainId, op: 'delete' }, 'global');
  }
}
