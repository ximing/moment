import { Service } from '@rabjs/react';
import type { ChainColor, ChainDto, ChainIcon, ShareLinkDto } from '@moment/dto';
import { client } from '../../lib/api';
import type { ChainChangedPayload } from '../../lib/events';

/** 设置页全部状态：链详情 + 资料/标签表单 + 成员 + 邀请 + 分享链接 + 危险区。 */
export class ChainSettingsService extends Service {
  chainId = '';
  chain: ChainDto | null = null;

  members: Awaited<ReturnType<typeof client.listMembers>> = [];
  invites: Awaited<ReturnType<typeof client.listInvites>> = [];
  shareLinks: ShareLinkDto[] = [];

  // 资料表单（name/description/color/icon；无封面——服务端 updateChain 不支持）
  formName = '';
  formDescription = '';
  formColor: ChainColor = 'coral';
  formIcon: ChainIcon | null = null;
  formHydrated = false;

  // 分享链接创建选项（与 web 同款）
  shareExpire: 'never' | '7' | '30' = 'never';

  private sectionsLoaded = false;

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
    void this.loadChain().catch(() => undefined);
  }

  get myRole(): string | undefined {
    return this.chain?.myRole;
  }

  async loadChain(): Promise<void> {
    this.chain = await client.getChain(this.chainId);
    if (!this.sectionsLoaded) {
      this.sectionsLoaded = true;
      void this.loadMembers().catch(() => undefined);
      if (this.chain.myRole === 'owner') {
        void this.loadShareLinks().catch(() => undefined);
      }
    }
    if (!this.formHydrated) {
      // 首载水合资料表单（之后用户改动不覆盖）
      this.formHydrated = true;
      this.formName = this.chain.name;
      this.formDescription = this.chain.description ?? '';
      this.formColor = this.chain.color ?? 'coral';
      this.formIcon = this.chain.icon;
    }
  }

  async loadMembers(): Promise<void> {
    this.members = await client.listMembers(this.chainId);
    // listInvites 仅 owner（editor 调会 403）；editor 生成邀请后看不到列表是既定取舍
    if (this.chain?.myRole === 'owner') {
      this.invites = await client.listInvites(this.chainId);
    } else {
      this.invites = [];
    }
  }

  async loadShareLinks(): Promise<void> {
    if (this.chain?.myRole !== 'owner') return;
    this.shareLinks = (await client.listShareLinks(this.chainId)).items;
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
    await client.createShareLink(this.chainId, expiresAt ? { expiresAt } : {});
    await this.loadShareLinks();
  }

  async revokeShareLink(id: string): Promise<void> {
    await client.revokeShareLink(id);
    await this.loadShareLinks();
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

  /** 退出链（owner 必须先转让，服务端 OWNER_MUST_TRANSFER 兜底）。 */
  async leaveChain(userId: string): Promise<void> {
    await client.removeMember(this.chainId, userId);
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
  }

  async transferChain(userId: string): Promise<void> {
    await client.transferChain(this.chainId, userId);
    // 转让后自己 owner→editor：扇出让 ChainListService 刷新 myRole（发布按钮/选链集合都吃它）
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
    await this.loadMembers();
    await this.loadChain();
  }

  async createInvite(): Promise<string> {
    const invite = await client.createInvite(this.chainId, { role: 'editor' });
    await this.loadMembers();
    return invite.token;
  }

  async revokeInvite(id: string): Promise<void> {
    await client.revokeInvite(id);
    await this.loadMembers();
  }

  async deleteChain(): Promise<void> {
    await client.deleteChain(this.chainId);
    this.emit('chain:changed', { chainId: this.chainId, op: 'delete' }, 'global');
  }
}
