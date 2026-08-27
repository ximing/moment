import { Service } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import type { ChainImageFocus, TemplateDto } from '@moment/dto';
import { client } from '@/api/client';
import type {
  ChainAppearanceDraft,
  ChainAvatarMode,
  ChainImageDraft,
} from '@/chain/appearance-model';
import { appearanceInputFromDraft, CENTER_FOCUS } from '@/chain/appearance-model';
import { discardDraftImage, uploadChainImage } from '@/chain/appearance-upload';
import type { ChainImagePlacement } from '@/chain/ChainAppearanceEditor';
import { humanError } from '@/lib/errors';

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

/** 保存闸的固定条件：无 uploading；image 模式 avatar ready 且 mediaId 非空。 */
function appearanceSaveable(draft: ChainAppearanceDraft): boolean {
  if (draft.avatar?.status === 'uploading' || draft.cover?.status === 'uploading') return false;
  if (draft.avatarMode === 'image') {
    const avatar = draft.avatar;
    if (avatar === null || avatar.status !== 'ready' || avatar.mediaId === null) return false;
  }
  return true;
}

/** 建链对话框（spec §4.7 + chain-appearance §7.1）：表单 + submit；开关本身是 Shell 的本地 boolean。 */
export class CreateChainDialogService extends Service {
  name = '';
  description = '';
  /** 官方模板候选（scope=official）；打开对话框时加载 */
  templates: TemplateDto[] = [];
  /** 选中的模板 key（spec §0：创建时选定不可改）；默认日常生活 */
  template = 'daily';

  /** 外观草稿（三模式互斥 + 独立封面）；默认纯色 coral（沿用旧表单默认） */
  appearance: ChainAppearanceDraft = {
    avatarMode: 'color',
    color: 'coral',
    icon: null,
    avatar: null,
    cover: null,
  };

  /** 保存闸：name 非空 + appearanceSaveable（上传中/未就绪不可提交半成品 mediaId） */
  get canSubmit(): boolean {
    return this.name.trim().length > 0 && appearanceSaveable(this.appearance);
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

  /** 三段互斥切换：草稿只保留新模式值；离开 image 模式时 abort 并回收 temp（persisted 不删）。 */
  setAvatarMode(mode: ChainAvatarMode): void {
    const prev = this.appearance;
    if (prev.avatarMode === mode) return;
    const replaced = prev.avatar;
    if (replaced !== null) teardownSlot(slotsFor(this).avatar);
    this.appearance = {
      ...prev,
      avatarMode: mode,
      color: mode === 'color' ? (prev.color ?? 'coral') : null,
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

  /** 关闭/卸载：abort 在途上传、撤销 object URL、best-effort 回收未持久化 temp。 */
  disposeAppearanceDraft(): void {
    const slots = slotsFor(this);
    teardownSlot(slots.avatar);
    teardownSlot(slots.cover);
    void discardDraftImage(client, this.appearance.avatar);
    void discardDraftImage(client, this.appearance.cover);
  }

  /** submit 成功：temp 媒体已随链绑定，标 persisted 防 close/unmount 误删 */
  private markAppearancePersisted(): void {
    const { avatar, cover } = this.appearance;
    this.appearance = {
      ...this.appearance,
      avatar: avatar !== null ? { ...avatar, persisted: true } : null,
      cover: cover !== null ? { ...cover, persisted: true } : null,
    };
  }

  async submit(): Promise<string> {
    const appearance = appearanceInputFromDraft(this.appearance);
    // create 的 color 不可为 null（DTO）：非纯色模式省略，服务端按优先级归一化；
    // 空媒体字段同样省略（新链 ≡ null），保持与既有客户端一致的调用形状
    const chain = await client.createChain({
      name: this.name.trim(),
      template: this.template,
      visibility: 'private',
      description: this.description.trim() || undefined,
      icon: appearance.icon ?? null,
      ...(appearance.color != null ? { color: appearance.color } : {}),
      ...(appearance.avatarMediaId != null
        ? { avatarMediaId: appearance.avatarMediaId, avatarFocus: appearance.avatarFocus ?? CENTER_FOCUS }
        : {}),
      ...(appearance.coverMediaId != null
        ? { coverMediaId: appearance.coverMediaId, coverFocus: appearance.coverFocus ?? CENTER_FOCUS }
        : {}),
    });
    this.markAppearancePersisted();
    this.emit('chain:changed', { chainId: chain.id, op: 'create' }, 'global');
    return chain.id;
  }

  /** 打开对话框时调用：拉官方模板（失败静默——列表为空时选择器不渲染，仍可建 daily 链） */
  async loadTemplates(): Promise<void> {
    this.templates = await client.listTemplates('official');
  }
}
