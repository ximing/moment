import { Service } from '@rabjs/react';
import type {
  ChainAppearanceColor,
  ChainDto,
  ChainIcon,
  ChainJobDto,
  PersonResponse,
  ShareLinkDto,
  TagResponse,
} from '@moment/dto';
import { client } from '../../lib/api';
import type { ChainChangedPayload } from '../../lib/events';

/** 设置页全部状态：链详情 + 资料/人物/标签 + 成员 + 邀请 + 分享链接 + 危险区。 */
export class ChainSettingsService extends Service {
  chainId = '';
  chain: ChainDto | null = null;

  members: Awaited<ReturnType<typeof client.listMembers>> = [];
  invites: Awaited<ReturnType<typeof client.listInvites>> = [];
  shareLinks: ShareLinkDto[] = [];
  jobs: ChainJobDto[] = [];
  tags: TagResponse[] = [];
  persons: PersonResponse[] = [];
  inviteEmail = '';
  newPersonName = '';
  newTagName = '';

  // 资料表单（name/description/color/icon；RN 不加图片/封面编辑——spec §1 非目标）
  formName = '';
  formDescription = '';
  // 链外观色（chain-appearance DTO）：ChainDto.color 已放宽为预设色或 #RRGGBB；
  // 只放宽链表单这一处，用户头像的 ChainColor 语义不动
  formColor: ChainAppearanceColor = 'coral';
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
    this.chain = null;
    this.members = [];
    this.invites = [];
    this.shareLinks = [];
    this.jobs = [];
    this.tags = [];
    this.persons = [];
    this.formHydrated = false;
    this.sectionsLoaded = false;
    this.inviteEmail = '';
    this.newPersonName = '';
    this.newTagName = '';
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
      void this.loadTags().catch(() => undefined);
      void this.loadPersons().catch(() => undefined);
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

  async loadJobs(): Promise<void> {
    if (!this.chainId) return;
    const res = await client.listChainJobs(this.chainId);
    this.jobs = res.jobs;
  }

  async loadTags(): Promise<void> {
    this.tags = (await client.listTags(this.chainId)).tags;
  }

  async loadPersons(): Promise<void> {
    this.persons = (await client.listPersons(this.chainId)).persons;
  }

  async addPerson(): Promise<void> {
    const name = this.newPersonName.trim();
    if (!name) return;
    await client.createPerson(this.chainId, { name });
    this.newPersonName = '';
    await this.loadPersons();
  }

  async renamePerson(personId: string, name: string): Promise<void> {
    const next = name.trim();
    if (!next) return;
    const current = this.persons.find((p) => p.id === personId);
    if (!current || current.name === next) return;
    await client.renamePerson(this.chainId, personId, { name: next });
    await this.loadPersons();
  }

  async removePerson(personId: string): Promise<void> {
    await client.removePerson(this.chainId, personId);
    await this.loadPersons();
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

  /** 选颜色：同时清 Emoji——新协议三模式互斥，显式表达「纯色」而不是把决定权推给服务端归一化。 */
  selectFormColor(color: ChainAppearanceColor): void {
    this.formColor = color;
    this.formIcon = null;
  }

  /** 选 Emoji：保留已选颜色，save 时服务端按 Emoji 优先归一化（§4.2 旧客户端兼容路径）。 */
  selectFormIcon(icon: ChainIcon): void {
    this.formIcon = icon;
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
    const email = this.inviteEmail.trim() || undefined;
    const invite = await client.createInvite(this.chainId, { email, role: 'editor' });
    this.inviteEmail = '';
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
