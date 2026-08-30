import { Service } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import type { ChainDto, ChainImageFocus, ChainJobDto, PersonResponse, ShareLinkDto } from '@moment/dto';
import { client } from '@/api/client';
import type {
  ChainAppearanceDraft,
  ChainAvatarMode,
  ChainImageDraft,
} from '@/chain/appearance-model';
import {
  appearanceDraftFromChain,
  appearanceInputFromDraft,
  CENTER_FOCUS,
} from '@/chain/appearance-model';
import { discardDraftImage, uploadChainImage } from '@/chain/appearance-upload';
import type { ChainImagePlacement } from '@/chain/ChainAppearanceEditor';
import { fallbackChainColor } from '@/lib/chain-color';
import { humanError } from '@/lib/errors';
import type { ChainChangedPayload } from '@/lib/events';

// 上传槽位（race-safe，spec §7.1）：每个 placement 持 generation 与 AbortController。
// 放模块级 WeakMap 而非 Service 字段——AbortController/File 不进 rab observable 状态，
// 避免代理包装与无关的重渲染通知。
interface AppearanceSlot {
  generation: number;
  controller: AbortController | null;
  objectUrl: string | null;
  /** 当前草稿对应的本地文件（重试用）；persisted 图片为 null */
  file: File | null;
}

function createSlot(): AppearanceSlot {
  return { generation: 0, controller: null, objectUrl: null, file: null };
}

const appearanceSlots = new WeakMap<object, Record<ChainImagePlacement, AppearanceSlot>>();

function slotsFor(owner: object): Record<ChainImagePlacement, AppearanceSlot> {
  let slots = appearanceSlots.get(owner);
  if (!slots) {
    slots = { avatar: createSlot(), cover: createSlot() };
    appearanceSlots.set(owner, slots);
  }
  return slots;
}

/** 递增 generation 作废旧回调、abort 在途上传、撤销 object URL。 */
function teardownSlot(slot: AppearanceSlot): void {
  slot.generation += 1;
  slot.controller?.abort();
  slot.controller = null;
  if (slot.objectUrl !== null) {
    URL.revokeObjectURL(slot.objectUrl);
    slot.objectUrl = null;
  }
  slot.file = null;
}

/** 保存闸的固定条件：无 uploading；image 模式 avatar ready 且 mediaId 非空；非空 cover 必须 ready（error 态放行会把 coverMediaId:null 当成删除封面）。 */
function appearanceSaveable(draft: ChainAppearanceDraft): boolean {
  if (draft.avatar?.status === 'uploading' || draft.cover?.status === 'uploading') return false;
  if (draft.avatarMode === 'image') {
    const avatar = draft.avatar;
    if (avatar === null || avatar.status !== 'ready' || avatar.mediaId === null) return false;
  }
  if (draft.cover !== null && draft.cover.status !== 'ready') return false;
  return true;
}

/** 设置页全部状态（spec §4.5 + chain-appearance §7.1）：链详情 + 成员 + 邀请 + 分享链接 + 资料表单 + 标签。 */
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
  formHydrated = false;
  /** 外观草稿（三模式互斥 + 独立封面）；loadChain 首载水合 */
  appearance: ChainAppearanceDraft = {
    avatarMode: 'color',
    color: null,
    icon: null,
    avatar: null,
    cover: null,
  };
  tags: Awaited<ReturnType<typeof client.listTags>>['tags'] = [];
  jobs: ChainJobDto[] = [];
  newTagName = '';
  /** 链级人物词典（记下时「和谁在一起」的名单） */
  persons: PersonResponse[] = [];
  newPersonName = '';

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
      void this.loadPersons().catch(() => undefined);
    }
    if (!this.formHydrated && this.chain) {
      // 首载水合资料表单（之后用户改动不覆盖）
      this.formHydrated = true;
      this.formName = this.chain.name;
      this.formDescription = this.chain.description ?? '';
      this.appearance = hydratedAppearance(this.chain);
    }
  }

  async loadJobs(): Promise<void> {
    const res = await client.listChainJobs(this.chainId);
    this.jobs = res.jobs;
  }

  /** 保存闸：name 非空 + appearanceSaveable（上传中/未就绪不可提交半成品 mediaId） */
  get canSave(): boolean {
    return this.formName.trim().length > 0 && appearanceSaveable(this.appearance);
  }

  private draftImage(placement: ChainImagePlacement): ChainImageDraft | null {
    return placement === 'avatar' ? this.appearance.avatar : this.appearance.cover;
  }

  private writeDraftImage(placement: ChainImagePlacement, image: ChainImageDraft | null): void {
    this.appearance =
      placement === 'avatar' ? { ...this.appearance, avatar: image } : { ...this.appearance, cover: image };
  }

  private patchDraftImage(placement: ChainImagePlacement, patch: Partial<ChainImageDraft>): void {
    const current = this.draftImage(placement);
    if (current === null) return;
    this.writeDraftImage(placement, { ...current, ...patch });
  }

  /** 三段互斥切换：草稿只保留新模式值；离开 image 模式时 abort 并回收 temp（persisted 不删，服务端替换时才 orphan）。 */
  setAvatarMode(mode: ChainAvatarMode): void {
    const prev = this.appearance;
    if (prev.avatarMode === mode) return;
    const replaced = prev.avatar;
    if (replaced !== null) teardownSlot(slotsFor(this).avatar);
    this.appearance = {
      ...prev,
      avatarMode: mode,
      color: mode === 'color' ? (prev.color ?? fallbackChainColor(this.chainId)) : null,
      icon: null,
      avatar: null,
    };
    void discardDraftImage(client, replaced);
  }

  selectEmoji(emoji: string): void {
    this.appearance = { ...this.appearance, icon: emoji };
  }

  /** editor 只回传预设色名或 normalizeChainHex 产物（大写 #RRGGBB） */
  selectColor(color: string): void {
    this.appearance = { ...this.appearance, color: color as ChainAppearanceDraft['color'] };
  }

  /** 选择图片：先占位本地 preview（uploading），presign/PUT 完成回调按 generation 防串台。 */
  selectAppearanceImage(placement: ChainImagePlacement, file: File): void {
    const slot = slotsFor(this)[placement];
    slot.generation += 1;
    const generation = slot.generation;
    slot.controller?.abort();
    slot.controller = new AbortController();
    const replaced = this.draftImage(placement);
    if (slot.objectUrl !== null) URL.revokeObjectURL(slot.objectUrl);
    const objectUrl = URL.createObjectURL(file);
    slot.objectUrl = objectUrl;
    slot.file = file;
    this.writeDraftImage(placement, {
      mediaId: null,
      src: objectUrl,
      focus: CENTER_FOCUS,
      persisted: false,
      status: 'uploading',
      progress: 0,
      error: null,
      fileName: file.name,
    });
    // 被替换的旧图：temp 回收；persisted 绝不 DELETE（服务端保存时才按替换语义 orphan）
    void discardDraftImage(client, replaced);

    const signal = slot.controller.signal;
    void uploadChainImage(
      client,
      file,
      {
        onMediaId: (mediaId) => {
          if (slot.generation !== generation) {
            // presign 完成时槽位已被替换/卸载：凭 id 立刻回收，不写入草稿
            void client.discardMedia(mediaId).catch(() => undefined);
            return;
          }
          this.patchDraftImage(placement, { mediaId });
        },
        onProgress: (loaded, total) => {
          if (slot.generation !== generation) return;
          this.patchDraftImage(placement, {
            progress: total > 0 ? Math.min(100, (loaded / total) * 100) : 0,
          });
        },
      },
      signal,
    )
      .then(() => {
        if (slot.generation !== generation) return; // 过期完成不写草稿
        this.patchDraftImage(placement, { status: 'ready', progress: 100 });
      })
      .catch((err: unknown) => {
        if (slot.generation !== generation) return;
        if (err instanceof ApiError && err.code === 'ABORTED') return; // 取消不是失败
        this.patchDraftImage(placement, { status: 'error', error: humanError(err) });
      });
  }

  /** 删除图片：abort + revoke + 清空草稿；temp best-effort DELETE，persisted 保留到保存时由服务端替换 */
  discardAppearanceImage(placement: ChainImagePlacement): void {
    const image = this.draftImage(placement);
    if (image === null) return;
    teardownSlot(slotsFor(this)[placement]);
    this.writeDraftImage(placement, null);
    void discardDraftImage(client, image);
  }

  /** 失败重试：沿用同一文件重新走选择路径（递增 generation、回收失败 temp） */
  retryAppearanceImage(placement: ChainImagePlacement): void {
    const file = slotsFor(this)[placement].file;
    if (file === null) return;
    this.selectAppearanceImage(placement, file);
  }

  setAppearanceFocus(placement: ChainImagePlacement, focus: ChainImageFocus): void {
    this.patchDraftImage(placement, { focus });
  }

  /** 页面卸载：abort 在途上传、撤销 object URL、best-effort 回收未持久化 temp（persisted 资源绝不删）。 */
  disposeAppearanceDraft(): void {
    const slots = slotsFor(this);
    teardownSlot(slots.avatar);
    teardownSlot(slots.cover);
    void discardDraftImage(client, this.appearance.avatar);
    void discardDraftImage(client, this.appearance.cover);
  }

  async saveProfile(): Promise<void> {
    const appearance = appearanceInputFromDraft(this.appearance);
    // update 的 color 同样不可为 null（DTO）：非纯色模式省略，服务端据非空选择器切模式
    const updated = await client.updateChain(this.chainId, {
      name: this.formName.trim(),
      description: this.formDescription.trim() || null,
      icon: appearance.icon ?? null,
      ...(appearance.color != null ? { color: appearance.color } : {}),
      avatarMediaId: appearance.avatarMediaId ?? null,
      ...(appearance.avatarMediaId != null
        ? { avatarFocus: appearance.avatarFocus ?? CENTER_FOCUS }
        : {}),
      coverMediaId: appearance.coverMediaId ?? null,
      ...(appearance.coverMediaId != null ? { coverFocus: appearance.coverFocus ?? CENTER_FOCUS } : {}),
    });
    // 保存成功：用返回的新 ChainDto 重新水合草稿——temp 转正 persisted + 稳定 URL +
    // 服务端归一化焦点，同时兜底服务端 normalize（旧 color+icon 组合等）的字段差异
    this.chain = updated;
    this.appearance = hydratedAppearance(updated);
    this.emit('chain:changed', { chainId: this.chainId, op: 'update' }, 'global');
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

/**
 * ChainDto → 外观草稿；legacy 全空链（color/icon/avatar 全 null）按 id 哈希色预填——
 * 与展示层回退同色，且首次保存即把该链持久化为明确纯色（spec §3.3）。
 */
function hydratedAppearance(chain: ChainDto): ChainAppearanceDraft {
  const draft = appearanceDraftFromChain(chain);
  if (draft.avatarMode === 'color' && draft.color === null) {
    return { ...draft, color: fallbackChainColor(chain.id) };
  }
  return draft;
}
