import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_SECONDS } from '@moment/dto';
import type { ChainMemberDto, MomentResponse, PersonBrief, PersonResponse, PublicShareMoment, TagResponse, TemplateManifest } from '@moment/dto';
import { client } from '@/api/client';
import { compressImage } from '@/lib/compress';
import { firstGps } from '@/compose/exif-gps';
import { humanError } from '@/lib/errors';
import { formatBytes, nowLocalInput, probeVideo } from '@/lib/media';
import { canCompose } from '@/lib/roles';
import { summarizePayload } from '@/lib/template';
import { currentTzOffset, toWallClockInput, wallClockToIso } from '@/lib/time';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import type { ComposeRequest } from '@/services/compose-session.service';
import type { VoiceDraft } from './voice-recorder';

export interface PickedImage {
  file: File;
  previewUrl: string;
}

export interface PickedVideo {
  file: File;
  previewUrl: string;
  durationSeconds: number;
}

function isPastHappenedAt(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms - Date.now()) > 5 * 60_000;
}

/** 发布面板（spec §4.6）：草稿活在面板生命周期；submit 成功 emit + markCreated + close。 */
export class ComposePanelService extends Service {
  request: ComposeRequest | null = null;
  pickedChainId = '';
  content = '';
  images: PickedImage[] = [];
  video: PickedVideo | null = null;
  /** 封面草稿（spec video-poster §3：与视频选择同生同灭）；截帧失败保持 null = 无封面发布 */
  posterBlob: Blob | null = null;
  posterMediaId: string | null = null;
  /** 语音草稿（spec voice-moment §5）：与视频互斥；与图片可共存（voice = 1 语音 + ≤8 附图） */
  voice: VoiceDraft | null = null;
  replaceConfirm: 'image' | 'video' | null = null;
  pendingFiles: File[] = [];
  happenedAt = nowLocalInput();
  selectedTags: string[] = [];
  newTag = '';
  progress: string | null = null;
  error: string | null = null; // 本地校验 + humanError(API) 都落这里（面板内，spec §8）
  tagList: TagResponse[] = [];
  /** 当前链的模板 manifest（链详情内嵌，spec §3.2）；null = 未加载或无扩展 */
  manifest: TemplateManifest | null = null;
  /** 结构化类别（spec §1.1）；standard = 普通 moment。编辑模式锁定为原 kind（S4：不允许切 kind） */
  kind = 'standard';
  /** momentFields / kind payload 的草稿值；key 与 manifest 声明一致 */
  payloadDraft: Record<string, unknown> = {};
  geoBusy = false;
  // ---- 人物与地点（spec people-place §3/§6/§7）----
  /** 链 person 词典（选择器数据源，spec §6 GET persons） */
  personList: PersonResponse[] = [];
  /** 链成员（置顶 chip 数据源；选中 = 以该用户建/复用 person，spec §7） */
  members: ChainMemberDto[] = [];
  /** 选中人物全集（展示态含 source 供 AI 角标；提交时只取 id，source 永不上送） */
  selectedPersons: PersonBrief[] = [];
  personQuery = '';
  /** dirty tracking（spec §6）：仅用户实际增删过人物才提交 personIds（动作级判脏，见计划偏差 3） */
  personsTouched = false;
  /** 地点草稿：name 手动输入；coords 来自 EXIF（或编辑回读）。两者独立可组合 */
  placeName = '';
  placeCoords: { lat: number; lng: number } | null = null;
  /** dirty tracking（spec §6）：仅用户实际改过地点才提交 place；place:null = 显式清除 */
  placeTouched = false;
  /** 用户点 × 移除 EXIF chip 后本面板会话不再自动回填（否则删不掉，见计划偏差 2） */
  exifDismissed = false;
  private manifestChainId = '';

  get chainList(): ChainListService {
    return this.resolve(ChainListService);
  }

  get writableChains() {
    return this.chainList.chains.filter(canCompose);
  }

  get chainId(): string {
    return this.pickedChainId || this.writableChains[0]?.id || '';
  }

  get edit(): PublicShareMoment | undefined {
    return this.request?.edit;
  }

  get needChainPick(): boolean {
    return !this.edit && !this.request?.chainId && this.writableChains.length > 1 && !this.chainId;
  }

  hydrate(request: ComposeRequest): void {
    this.request = request;
    this.pickedChainId = request.chainId ?? request.edit?.chainId ?? '';
    this.content = request.edit?.content ?? '';
    this.happenedAt = request.edit
      ? toWallClockInput(request.edit.happenedAt, request.edit.happenedTzOffset)
      : nowLocalInput();
    this.selectedTags = request.edit?.tags.map((t) => t.id) ?? [];
    // 编辑模式：kind 锁定原值，payload 草稿从既有值水合（S4：提交时 kind+payload 始终显式携带）
    this.kind = request.edit?.kind ?? 'standard';
    this.payloadDraft = { ...(request.edit?.payload ?? {}) };
    this.manifest = null;
    this.manifestChainId = '';
    // 人物/地点水合（spec §6）：编辑模式展示全集（含 ai 行，source 仅供角标）；
    // 三个 touched 标志复位——未动过就不提交（undefined = 不变）。
    // cast：ComposeRequest.edit 类型为 PublicShareMoment（分享/编辑共用形态），
    // 但编辑路径运行时必为链内完整 MomentResponse（plan 偏差 8 同款收窄，不改 ComposeRequest）
    const editMoment = request.edit as MomentResponse | undefined;
    this.selectedPersons = editMoment ? [...editMoment.persons] : [];
    this.personsTouched = false;
    this.placeName = editMoment?.place?.name ?? '';
    this.placeCoords =
      editMoment?.place?.lat != null && editMoment?.place?.lng != null
        ? { lat: editMoment.place.lat, lng: editMoment.place.lng }
        : null;
    this.placeTouched = false;
    this.exifDismissed = false;
    this.personList = [];
    this.members = [];
    this.personQuery = '';
  }

  async loadTagList(): Promise<void> {
    if (!this.chainId) {
      this.tagList = [];
      return;
    }
    this.tagList = (await client.listTags(this.chainId)).tags;
  }

  /** 拉链 person 词典 + 成员（选择器数据源）。失败静默：辅助输入不阻塞发布主流程（对齐 loadManifest 先例）。
   *  两路独立成败（allSettled）：词典与成员来自两个接口，词典失败只清词典，不牵连成员置顶。 */
  async loadPersons(): Promise<void> {
    const chainId = this.chainId;
    if (!chainId) {
      this.personList = [];
      this.members = [];
      return;
    }
    const [res, members] = await Promise.allSettled([
      client.listPersons(chainId),
      client.listMembers(chainId),
    ]);
    if (this.chainId !== chainId) return; // 异步返回时链已切换则丢弃（防串链）
    this.personList = res.status === 'fulfilled' ? res.value.persons : [];
    this.members = members.status === 'fulfilled' ? members.value : [];
  }

  /** 面板内切链（评审 H4）：重置结构化状态——旧链的 kind/payload 草稿对新链模板无意义；
   *  manifest 置 null 使 TemplateFields 在新 manifest 到达前不渲染（await 期间无旧表单可提交）。 */
  pickChain(chainId: string): void {
    if (this.pickedChainId === chainId) return;
    this.pickedChainId = chainId;
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
    // 人物词典是链级作用域（spec §0）：切链丢弃旧链选择
    this.personList = [];
    this.members = [];
    this.selectedPersons = [];
    this.personsTouched = false;
  }

  /** 链切换时拉模板 manifest（链详情内嵌；同链幂等）。失败静默：无扩展字段可填，主流程不阻塞。 */
  async loadManifest(chainId: string): Promise<void> {
    if (!chainId || this.manifestChainId === chainId) return;
    this.manifestChainId = chainId;
    const detail = await client.getChain(chainId);
    // 异步返回时链已切换则丢弃（防串链）
    if (this.chainId === chainId) this.manifest = detail.templateManifest;
  }

  /** 切 kind（仅新建；编辑模式 UI 不提供入口）。切走清空草稿，防旧值按新 kind 校验不过（S4 推论）。 */
  setKind(kind: string): void {
    this.kind = kind;
    this.payloadDraft = {};
  }

  /** momentField / kind 字段值写入草稿；undefined 表示清除该 key */
  setFieldValue(key: string, value: unknown): void {
    const next = { ...this.payloadDraft };
    if (value === undefined) delete next[key];
    else next[key] = value;
    this.payloadDraft = next;
  }

  /** geo 字段：浏览器定位（Geolocation API）；失败写 error，草稿不留半成品 */
  async pickGeo(fieldKey: string): Promise<void> {
    if (!('geolocation' in navigator)) {
      this.error = '这个浏览器不支持定位';
      return;
    }
    this.geoBusy = true;
    this.error = null;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000 }),
      );
      const prev = this.payloadDraft[fieldKey] as { place_name?: string } | undefined;
      this.setFieldValue(fieldKey, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ...(prev?.place_name ? { place_name: prev.place_name } : {}),
      });
    } catch {
      this.error = '没拿到定位，检查一下浏览器权限';
    } finally {
      this.geoBusy = false;
    }
  }

  async createTag(): Promise<void> {
    const name = this.newTag.trim();
    if (!name || !this.chainId) return;
    try {
      const tag = await client.createTag(this.chainId, name);
      this.selectedTags = [...this.selectedTags, tag.id];
      this.newTag = '';
      await this.loadTagList();
    } catch (e) {
      this.error = humanError(e);
    }
  }

  toggleTag(id: string): void {
    this.selectedTags = this.selectedTags.includes(id)
      ? this.selectedTags.filter((x) => x !== id)
      : [...this.selectedTags, id];
  }

  /** 词典行 → PersonBrief（词典行无 source；选中是用户主动选择，语义恒 manual，spec §6 提交即 manual 意图）。 */
  private asBrief(person: PersonResponse | PersonBrief): PersonBrief {
    return 'source' in person ? person : { ...person, source: 'manual' as const };
  }

  /** 人物增删切换；置 personsTouched（动作级判脏：删除后加回同一 ai person 也要提交，spec §5 升级路径）。 */
  togglePerson(person: PersonBrief): void {
    this.personsTouched = true;
    this.selectedPersons = this.selectedPersons.some((p) => p.id === person.id)
      ? this.selectedPersons.filter((p) => p.id !== person.id)
      : [...this.selectedPersons, person];
  }

  /** 选中链成员 = 以该用户建/复用 person（spec §7）：词典/已选集有 userId 命中直接选，否则幂等 POST。 */
  async toggleMember(member: ChainMemberDto): Promise<void> {
    const existing =
      this.personList.find((p) => p.userId === member.userId) ??
      this.selectedPersons.find((p) => p.userId === member.userId);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      return;
    }
    try {
      const person = await client.createPerson(this.chainId, { name: member.nickname, userId: member.userId });
      if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
      this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
    } catch (e) {
      this.error = humanError(e);
    }
  }

  /** 词典搜索命中同名直接选；否则自由文本回车新建（幂等 POST，归一化撞名返回已存在行，spec §6/§7）。 */
  async submitPersonQuery(): Promise<void> {
    const name = this.personQuery.trim();
    if (!name || !this.chainId) return;
    const existing =
      this.personList.find((p) => p.name === name) ?? this.selectedPersons.find((p) => p.name === name);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      this.personQuery = '';
      return;
    }
    try {
      const person = await client.createPerson(this.chainId, { name });
      if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
      this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
      this.personQuery = '';
    } catch (e) {
      this.error = humanError(e);
    }
  }

  setPlaceName(name: string): void {
    this.placeTouched = true;
    this.placeName = name;
  }

  /** 移除 EXIF chip（spec §3「可点 × 移除」）：丢弃坐标且本会话不再自动回填。 */
  removePlaceCoords(): void {
    this.placeTouched = true;
    this.exifDismissed = true;
    this.placeCoords = null;
  }

  addImages(files: File[]): void {
    this.error = null;
    void this.ingestExif(files).catch(() => undefined);
    const next = [...this.images];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        this.error = `「${file.name}」超过图片上限（${formatBytes(MAX_IMAGE_BYTES)}）`;
        continue;
      }
      const cap = this.voice ? 8 : 9; // voice 附图 ≤8（1 audio + ≤8 图 ≤ 9 mediaIds，spec §2.2）
      if (next.length >= cap) {
        this.error = this.voice ? '语音时刻最多 8 张附图' : '最多 9 张图片';
        break;
      }
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    this.images = next;
  }

  /** 截帧组件回调；blob 为 null = 截帧失败降级（静默无封面） */
  setPoster(blob: Blob | null): void {
    this.posterBlob = blob;
    this.posterMediaId = null; // 换帧后已上传的 id 作废（重传；旧行按 §2.4 ready-unbound gap 处理）
  }

  /** 视频重置路径统一调用：丢弃已截帧/已上传的封面草稿（位图与 posterMediaId 一并清空） */
  private resetPoster(): void {
    this.posterBlob = null;
    this.posterMediaId = null;
  }

  /** 录音组件回调；draft 为 null = 重录/清空。语音与视频互斥；已有图片截断到 8 张（voice 附图上限） */
  setVoice(draft: VoiceDraft | null): void {
    if (this.voice && this.voice.previewUrl !== draft?.previewUrl) {
      URL.revokeObjectURL(this.voice.previewUrl);
    }
    this.voice = draft;
    if (draft) {
      if (this.video) {
        URL.revokeObjectURL(this.video.previewUrl);
        this.video = null;
        this.resetPoster();
      }
      if (this.images.length > 8) {
        const dropped = this.images.splice(8);
        dropped.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      }
    }
  }

  /** 语音重置统一入口：revoke previewUrl 并清空草稿 */
  private resetVoice(): void {
    if (this.voice) URL.revokeObjectURL(this.voice.previewUrl);
    this.voice = null;
  }

  async addVideo(file: File): Promise<void> {
    this.error = null;
    if (file.size > MAX_VIDEO_BYTES) {
      this.error = `视频超过上限（${formatBytes(MAX_VIDEO_BYTES)}）`;
      return;
    }
    try {
      const meta = await probeVideo(file);
      if (meta.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
        this.error = `视频最长 ${MAX_VIDEO_DURATION_SECONDS / 60} 分钟`;
        return;
      }
      if (this.video) URL.revokeObjectURL(this.video.previewUrl); // 显式 revoke（spec §5）
      this.resetPoster();
      this.resetVoice();
      this.video = { file, durationSeconds: meta.durationSeconds, previewUrl: URL.createObjectURL(file) };
    } catch {
      this.error = '无法读取视频';
    }
  }

  /** file input onChange 的分流（图/视频互斥确认），input 本身在组件 */
  onPickImages(files: File[]): void {
    if (this.video) {
      this.pendingFiles = files;
      this.replaceConfirm = 'image';
      return;
    }
    this.addImages(files);
  }

  onPickVideo(file: File): void {
    if (this.images.length > 0) {
      this.pendingFiles = [file];
      this.replaceConfirm = 'video';
      return;
    }
    void this.addVideo(file);
  }

  cancelReplace(): void {
    this.replaceConfirm = null;
    this.pendingFiles = [];
  }

  confirmReplace(): void {
    if (this.replaceConfirm === 'image') {
      if (this.video) URL.revokeObjectURL(this.video.previewUrl); // 显式 revoke
      this.video = null;
      this.resetPoster();
      this.addImages(this.pendingFiles);
    }
    if (this.replaceConfirm === 'video' && this.pendingFiles[0]) {
      this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl)); // 显式 revoke
      this.images = [];
      void this.addVideo(this.pendingFiles[0]);
    }
    this.replaceConfirm = null;
    this.pendingFiles = [];
  }

  removeImage(index: number): void {
    URL.revokeObjectURL(this.images[index]!.previewUrl); // 显式 revoke
    this.images = this.images.filter((_, i) => i !== index);
  }

  /** 关闭/取消/Escape：先 revoke 全部预览，再关会话（不依赖 destroy/GC，spec §5） */
  resetAndClose(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.resetPoster();
    this.resetVoice();
    this.resolve(ComposeSessionService).closeCompose();
  }

  private clearPreviews(): void {
    this.images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    if (this.video) URL.revokeObjectURL(this.video.previewUrl);
    this.images = [];
    this.video = null;
    this.resetPoster();
    this.resetVoice();
  }

  /**
   * EXIF 自动回填（spec §3）：多图取第一张含 GPS 的；仅地点草稿完全为空时写入
   * （已手动输入或已移除 chip 不覆盖，偏差 2）。非用户动作，不置 placeTouched。
   */
  private async ingestExif(files: File[]): Promise<void> {
    if (this.exifDismissed || this.placeCoords || this.placeName.trim() !== '') return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    const coords = await firstGps(images);
    if (coords && !this.exifDismissed && !this.placeCoords && this.placeName.trim() === '') {
      this.placeCoords = coords;
    }
  }

  /**
   * place 提交形态（spec §6 赋值表在 server 判 source，客户端只交 name/坐标）：
   * 名字（trim 后）与坐标皆空 → null（显式清除）；有坐标 ±名字 → 整体提交
   * （坐标+名字 → manual「确认后的形态」；仅坐标 → exif）；仅名字 → {name}（manual 文本）。
   */
  private placePayload(): { name?: string; lat?: number; lng?: number } | null {
    const name = this.placeName.trim();
    if (name === '' && !this.placeCoords) return null;
    return this.placeCoords
      ? { ...(name !== '' ? { name } : {}), lat: this.placeCoords.lat, lng: this.placeCoords.lng }
      : { name };
  }

  async submit(): Promise<void> {
    this.error = null;
    const edit = this.edit;
    const chainId = this.chainId;
    if (!chainId) {
      this.error = '先选一条链';
      return;
    }
    if (this.selectedPersons.length > 20) {
      this.error = '最多关联 20 位人物';
      return;
    }
    const hasImages = this.images.length > 0;
    const hasVideo = Boolean(this.video);
    const hasVoice = Boolean(this.voice);
    const structuredOnly = this.kind !== 'standard';
    if (!hasImages && !hasVideo && !hasVoice && this.content.trim().length === 0 && !structuredOnly) {
      this.error = '先写一句此刻吧';
      return;
    }
    const timeEdited = Boolean(edit) && this.happenedAt !== toWallClockInput(edit!.happenedAt, edit!.happenedTzOffset);
    const happenedIso = edit
      ? timeEdited
        ? wallClockToIso(this.happenedAt, edit.happenedTzOffset)
        : edit.happenedAt
      : new Date(Date.parse(this.happenedAt)).toISOString();
    const happenedAtMs = Date.parse(happenedIso);
    if (Number.isNaN(happenedAtMs)) {
      this.error = '发生时间不合法';
      return;
    }
    const isBackfill = edit && !timeEdited ? edit.isBackfill : isPastHappenedAt(happenedAtMs);
    const composeSession = this.resolve(ComposeSessionService);
    try {
      if (edit) {
        await client.updateMoment(edit.id, {
          content: this.content,
          ...(timeEdited ? { happenedAt: happenedIso, happenedTzOffset: edit.happenedTzOffset } : {}),
          isBackfill,
          tagIds: this.selectedTags,
          kind: edit.kind,
          payload: Object.keys(this.payloadDraft).length > 0 ? this.payloadDraft : null,
          // dirty tracking（spec §6）：undefined = 不变——未动过的人物/地点绝不整包回传
          ...(this.personsTouched ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
          ...(this.placeTouched ? { place: this.placePayload() } : {}),
        });
        composeSession.emit('moment:changed', { momentId: edit.id, chainId: edit.chainId, op: 'update' }, 'global');
      } else {
        const type = hasVoice ? 'voice' : hasVideo ? 'video' : hasImages ? 'media' : 'text';
        const mediaIds: string[] = [];
        if (this.voice) {
          this.progress = '上传语音…';
          const res = await client.uploadMedia({
            file: this.voice.blob,
            mime: 'audio/wav',
            size: this.voice.blob.size,
            kind: 'audio',
            durationSeconds: this.voice.durationSeconds,
            onProgress: (l, t) => (this.progress = `上传语音 ${Math.round((l / t) * 100)}%`),
          });
          mediaIds.push(res.mediaId);
        }
        if (hasImages) {
          for (let i = 0; i < this.images.length; i++) {
            this.progress = `上传图片 ${i + 1}/${this.images.length}`;
            const file = await compressImage(this.images[i]!.file);
            const res = await client.uploadMedia({
              file,
              mime: file.type,
              size: file.size,
              kind: 'image',
              sortOrder: i,
              onProgress: (l, t) => (this.progress = `上传图片 ${i + 1}/${this.images.length} ${Math.round((l / t) * 100)}%`),
            });
            mediaIds.push(res.mediaId);
          }
        }
        if (this.video) {
          this.progress = '上传视频…';
          const res = await client.uploadMedia({
            file: this.video.file,
            mime: this.video.file.type,
            size: this.video.file.size,
            kind: 'video',
            durationSeconds: this.video.durationSeconds,
            onProgress: (l, t) => (this.progress = `上传视频 ${Math.round((l / t) * 100)}%`),
          });
          mediaIds.push(res.mediaId);
        }
        if (this.video && this.posterBlob && !this.posterMediaId) {
          try {
            this.progress = '上传封面…';
            const res = await client.uploadMedia({
              file: this.posterBlob,
              mime: 'image/jpeg',
              size: this.posterBlob.size,
              kind: 'image',
            });
            this.posterMediaId = res.mediaId;
          } catch {
            this.posterMediaId = null; // 封面上传失败降级为无封面发布（spec §3）
          }
        }
        this.progress = '记下…';
        const hasPayload = Object.keys(this.payloadDraft).length > 0;
        // kind moment 正文兜底（Global Constraints）：正文空时用结构摘要，满足 text 类型 content 必填。
        // 兜底填入的摘要与 Task 5 卡片摘要行逐字相同——卡片侧按 content===summary 判重跳过（评审 H1），不重复显示
        const summary = this.kind !== 'standard' ? summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft) : '';
        if (this.kind !== 'standard' && this.content.trim().length === 0 && !summary && !hasImages && !hasVideo && !hasVoice) {
          // 摘要也为空时不发空 content 给 server 被 400（CONTENT_REQUIRED），前置人话提示（评审 S8）
          this.error = '选一项或写一句，再记下';
          this.progress = null;
          return;
        }
        const content = this.content.trim().length === 0 && this.kind !== 'standard' ? summary : this.content;
        const res = await client.createMoment(chainId, {
          type,
          content,
          happenedAt: new Date(happenedAtMs).toISOString(),
          happenedTzOffset: currentTzOffset(),
          isBackfill,
          mediaIds,
          tagIds: this.selectedTags,
          kind: this.kind,
          ...(hasPayload ? { payload: this.payloadDraft } : {}),
          ...(this.posterMediaId ? { posterMediaId: this.posterMediaId } : {}),
          ...(this.selectedPersons.length > 0 ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
          // EXIF 路（spec §3）：未动过但有坐标 → {lat,lng}（exif 分支）；动过按 placePayload（含 null 清除）
          ...(this.placeTouched || this.placeCoords ? { place: this.placePayload() } : {}),
        });
        composeSession.markCreated(res.id); // 「从链节长出来」微动效（spec §1.6）
        composeSession.emit('moment:changed', { momentId: res.id, chainId, op: 'create' }, 'global');
      }
      this.clearPreviews(); // 显式 revoke（spec §5）
      composeSession.closeCompose();
    } catch (e) {
      this.error = humanError(e);
    } finally {
      this.progress = null;
    }
  }
}
