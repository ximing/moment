import { Service } from '@rabjs/react';
import { MAX_IMAGE_BYTES, type ChainMemberDto, type MediaCompleteResponse, type MomentMedia, type MomentResponse, type MomentType, type PatchMomentInput, type PersonBrief, type PersonResponse, type TemplateManifest } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import * as Location from 'expo-location';
import { client } from '../../lib/api';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { compressImage, pickImages, pickVideo, uriToBlob, validateVideo, type PickedVideo, type ReadyImage } from '../../lib/media';
import { summarizePayload } from '../../lib/template';
import { firstAssetGps } from '../../lib/exif-gps';
import { ChainListService } from '../../services/chain-list.service';

/** 总尝试次数 = 初始 1 次 + ≤2 次重试；网络类（status 0）/5xx 才重试。
 *  服务端 complete 幂等，重试会重新 presign 拿新 mediaId，旧 mediaId 残留由 sweeper 清理。 */
const UPLOAD_ATTEMPTS = 3;

async function uploadWithRetry(
  input: Parameters<typeof client.uploadMedia>[0]
): Promise<MediaCompleteResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await client.uploadMedia(input);
    } catch (err) {
      lastError = err;
      // 413 本地预校验、401（refresh 已失败并 clear 后的残余请求）、403 等重试无意义
      if (err instanceof ApiError && err.status !== 0 && err.status < 500) throw err;
    }
  }
  throw lastError;
}

/** 录音完成的语音草稿（fileUri 形态：uploadWithRetry 经 rn-put 按 FilePart 读盘，整文件不进内存） */
export interface VoiceDraft {
  uri: string;
  mime: string;
  size: number;
  durationSeconds: number;
}

export function editImageCap(edit: { type: MomentType }): 8 | 9 {
  return edit.type === 'voice' ? 8 : 9;
}

export function editOccupied(keptMedia: MomentMedia[], images: ReadyImage[]): number {
  return keptMedia.length + images.length;
}

/** 发布页（spec §6）：草稿进 Service，提交是显式动作，无 effect 链式 setState。 */
export class ComposeService extends Service {
  chainId: string | undefined = undefined;
  type: MomentType = 'text';
  content = '';
  images: ReadyImage[] = [];
  video: PickedVideo | null = null;
  /** 封面草稿（spec video-poster §4：v1 固定首帧，无选帧 UI；与视频选择同生同灭） */
  poster: { uri: string } | null = null;
  posterMediaId: string | null = null;
  /** 语音草稿（spec voice-moment §6）：type=voice 时必有；与图片可共存（≤8 附图） */
  voice: VoiceDraft | null = null;
  happenedAt = new Date();
  isBackfill = false;
  tagIds: string[] = [];
  progressLabel: string | null = null;
  showPicker = false; // 日期时间选择器展开态（iOS spinner 需要显式收起）

  tagNames: { id: string; name: string }[] = [];

  // ---- 人物与地点（spec people-place §3/§6/§7；dirty tracking 纪律镜像 P5 已评审结论）----
  /** 链 person 词典（选择器数据源，spec §6 GET persons） */
  personList: PersonResponse[] = [];
  /** 链成员（置顶 chip 数据源；选中 = 以该用户建/复用 person，spec §7） */
  members: ChainMemberDto[] = [];
  /** 选中人物全集（展示态含 source 供 AI 角标；提交时只取 id，source 永不上送） */
  selectedPersons: PersonBrief[] = [];
  personQuery = '';
  /** dirty tracking（spec §6）：仅用户实际增删过人物才提交 personIds——动作级判脏
   *  （P5 偏差 3：删除后加回同一 ai person，id 集合与基线相同也要提交，spec §5 升级路径） */
  personsTouched = false;
  /** 地点草稿：name 手动输入；coords 来自 EXIF（或编辑回读）。两者独立可组合 */
  placeName = '';
  placeCoords: { lat: number; lng: number } | null = null;
  /** dirty tracking（spec §6）：仅用户实际改过地点才提交 place；place:null = 显式清除 */
  placeTouched = false;
  /** 用户移除 EXIF chip 后本面板会话不再自动回填（否则删不掉，P5 偏差 2） */
  exifDismissed = false;

  /** 当前链的模板 manifest（链详情内嵌，spec §3.2）；null = 未加载或无扩展 */
  manifest: TemplateManifest | null = null;
  /** 结构化类别（spec §1.1）；standard = 普通 moment。编辑模式锁定为原 kind（S4：不允许切 kind） */
  kind = 'standard';
  /** momentFields / kind payload 的草稿值；key 与 manifest 声明一致 */
  payloadDraft: Record<string, unknown> = {};
  geoBusy = false;
  private manifestChainId = '';

  /** 编辑态：被编辑的 moment（spec §2）。非 null 时类型/链/媒体锁定，提交走 PATCH。 */
  edit: MomentResponse | null = null;
  /** 记录时区墙钟毫秒 = Date.parse(edit.happenedAt) − happenedTzOffset·60_000。
   *  只作数值参与换算，绝不当设备本地时间用（spec §2 review C1）。 */
  private editWallMs = 0;
  /** 设备时区偏移（getTimezoneOffset 分钟），loadForEdit 采样一次、提交复用同一值（防 DST 期间偏移漂移）。 */
  private editDeviceOffset = 0;
  /** 编辑态留下的已发布内容格（image/*；media 存量 video/* 也占格）。audio 永不进入。 */
  keptMedia: MomentMedia[] = [];
  /** 仅 voice 编辑：原 audio 行。loadForEdit 会把 this.voice 清掉，cap 禁止再读 this.voice。 */
  keptAudio: MomentMedia | null = null;
  /** 动作级 dirty：叉/加过媒体才把 mediaIds 放进 PATCH */
  mediaTouched = false;
  baselineMediaIds: string[] = [];

  get isEdit(): boolean {
    return this.edit !== null;
  }

  /** 路由 param 进来（?chainId= / ?momentId=）；compose 是 modal 路由，bindServices 实例随页面生灭，不挡幂等。 */
  hydrate(chainId: string | undefined, momentId?: string): void {
    if (momentId) {
      // 编辑分支：加载/失败态单通道走 $model.loadForEdit
      void this.loadForEdit(momentId).catch(() => undefined);
      return;
    }
    this.chainId = chainId;
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
    // 人物/地点草稿复位（spec §6）：新建面板每次进入都是干净草稿
    this.personList = [];
    this.members = [];
    this.selectedPersons = [];
    this.personQuery = '';
    this.personsTouched = false;
    this.placeName = '';
    this.placeCoords = null;
    this.placeTouched = false;
    this.exifDismissed = false;
    // manifest 锚点用 activeChainId 而非原始路由参数（评审 B2）：含「回退第一条可编辑链」
    // 后的值——feed 首页 /compose 无 chainId、单链用户（无链 chips 可点）也要触发加载。
    // 此刻 ChainListService 可能未就绪（activeChainId undefined）→ 跳过，由组件 effect 重试（Step 3）
    const active = this.activeChainId;
    if (active) void this.loadManifest(active).catch(() => undefined);
    void this.loadTags().catch(() => undefined);
    void this.loadPersons().catch(() => undefined);
  }

  /** 编辑预填：content/tagIds/type/isBackfill + 发生时间两次平移（spec §2）。
   *  链固定为 edit.chainId（见 activeChainId），不回退可编辑链，防标签载错链 → TAG_NOT_IN_CHAIN。 */
  async loadForEdit(momentId: string): Promise<void> {
    const m = await client.getMoment(momentId);
    this.images = [];
    this.clearVideo();
    this.voice = null;
    this.mediaTouched = false;
    this.edit = m;
    this.chainId = m.chainId;
    this.type = m.type;
    this.content = m.content;
    this.tagIds = m.tags.map((t) => t.id);
    this.isBackfill = m.isBackfill;
    // 编辑模式：kind 锁定原值，payload 草稿从既有值水合（S4：提交时 kind+payload 始终显式携带）
    this.kind = m.kind;
    this.payloadDraft = { ...(m.payload ?? {}) };
    // 人物/地点水合（spec §6）：编辑模式展示全集（含 ai 行，source 仅供角标）；
    // touched 标志复位——未动过就不提交（undefined = 不变，P5 偏差 3/4 同款纪律）
    this.selectedPersons = m.persons.map((p) => ({ ...p }));
    this.personsTouched = false;
    this.placeName = m.place?.name ?? '';
    this.placeCoords =
      m.place?.lat != null && m.place?.lng != null ? { lat: m.place.lat, lng: m.place.lng } : null;
    this.placeTouched = false;
    this.exifDismissed = false;
    this.personQuery = '';
    // 时区换算（spec 公式，禁止走 Date 本地字段捷径）：
    // wallMs 是记录时区的墙钟毫秒；picker 按设备本地字段渲染 Date，
    // 所以显示值 = wallMs + deviceOffset，使该 Date 的设备本地字段恰好等于记录时区墙钟。
    this.editDeviceOffset = new Date().getTimezoneOffset();
    this.editWallMs = Date.parse(m.happenedAt) - m.happenedTzOffset * 60_000;
    this.happenedAt = new Date(this.editWallMs + this.editDeviceOffset * 60_000);
    if (m.type === 'media') {
      this.keptMedia = [...m.media];
      this.keptAudio = null;
      this.baselineMediaIds = this.keptMedia.map((row) => row.id);
    } else if (m.type === 'voice') {
      this.keptAudio = m.media.find((row) => row.mime.startsWith('audio/')) ?? null;
      this.keptMedia = m.media.filter((row) => row.mime.startsWith('image/'));
      this.baselineMediaIds = this.keptAudio
        ? [this.keptAudio.id, ...this.keptMedia.map((row) => row.id)]
        : [];
    } else {
      this.keptMedia = [];
      this.keptAudio = null;
      this.baselineMediaIds = [];
    }
    await this.loadTags();
    void this.loadManifest(m.chainId).catch(() => undefined);
    void this.loadPersons().catch(() => undefined);
  }

  /** 实时读全局链列表（与 FeedService.chainList 同款 getter），无一次性快照的过期窗口。 */
  get editableChains(): { id: string; name: string }[] {
    return this.resolve(ChainListService).chains
      .filter((c) => c.myRole !== 'viewer')
      .map((c) => ({ id: c.id, name: c.name }));
  }

  /** 编辑态链恒为 edit.chainId（spec §2：不回退可编辑链，防 TAG_NOT_IN_CHAIN）；
   *  新建态：路由参数的链若是 viewer 链（不在 editable 集合），回退到第一条可编辑链。 */
  get activeChainId(): string | undefined {
    if (this.edit) return this.edit.chainId;
    if (this.chainId && this.editableChains.some((c) => c.id === this.chainId)) return this.chainId;
    return this.editableChains[0]?.id;
  }

  setChain(id: string): void {
    if (this.chainId === id) return;
    this.chainId = id;
    this.tagIds = [];
    this.kind = 'standard';
    this.payloadDraft = {};
    this.manifest = null;
    this.manifestChainId = '';
    // 人物词典是链级作用域（spec §0）：切链丢弃旧链选择；place 草稿保留（镜像 images 切链行为）
    this.personList = [];
    this.members = [];
    this.selectedPersons = [];
    this.personsTouched = false;
    void this.loadTags().catch(() => undefined);
    void this.loadManifest(id).catch(() => undefined);
    void this.loadPersons().catch(() => undefined);
  }

  /** 只拉当前活跃链的标签（链集合本身由 ChainListService 实时持有）。 */
  private async loadTags(): Promise<void> {
    const active = this.activeChainId;
    if (active) {
      const tags = await client.listTags(active);
      this.tagNames = tags.tags.map((t) => ({ id: t.id, name: t.name }));
    }
  }

  /** 链切换时拉模板 manifest（链详情内嵌；同链幂等）。失败静默：无扩展字段可填，主流程不阻塞。 */
  async loadManifest(chainId: string): Promise<void> {
    if (!chainId || this.manifestChainId === chainId) return;
    this.manifestChainId = chainId;
    const detail = await client.getChain(chainId);
    // 防串链守卫且可重试（评审 B2）：仅当链仍匹配时落 manifest；不匹配
    // （含 ChainListService 未就绪、activeChainId 暂未命中该链）时清占位，
    // 允许组件 effect 在链列表就绪后重试——不静默丢弃、不占位锁死
    if (this.activeChainId === chainId) {
      this.manifest = detail.templateManifest;
    } else if (this.manifestChainId === chainId) {
      this.manifestChainId = '';
    }
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

  /** geo 字段：expo-location 前台定位；返回问题文案（null = 成功，草稿不留半成品）。
   *  权限拒绝/超时/不可用的人话文案与 P4 web 同口径。 */
  async pickGeo(fieldKey: string): Promise<string | null> {
    this.geoBusy = true;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return '没拿到定位权限，去系统设置里开一下';
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
      ]);
      const prev = this.payloadDraft[fieldKey] as { place_name?: string } | undefined;
      this.setFieldValue(fieldKey, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ...(prev?.place_name ? { place_name: prev.place_name } : {}),
      });
      return null;
    } catch {
      return '没拿到定位，检查一下定位服务是不是开着';
    } finally {
      this.geoBusy = false;
    }
  }

  /** 选图 + 压缩；返回 rejected 数（仅统计压缩后仍超 MAX_IMAGE_BYTES 被跳过的，名额截断不算）。
   *  满 9 张抛 Error（中文 message，组件 Alert）；压缩中途抛错也复位进度。 */
  async pickMoreImages(): Promise<number> {
    const cap = this.edit ? editImageCap(this.edit) : this.type === 'voice' ? 8 : 9;
    const occupied = this.edit ? editOccupied(this.keptMedia, this.images) : this.images.length;
    const remain = cap - occupied;
    const voiceCap = this.edit ? this.edit.type === 'voice' : this.type === 'voice';
    if (remain <= 0) throw new Error(voiceCap ? '语音时刻最多 8 张附图' : '图片最多 9 张');
    const picked = this.edit ? await pickImages({ selectionLimit: remain }) : await pickImages();
    if (picked.length === 0) return 0;
    const kept = this.edit ? picked : picked.slice(0, remain);
    // EXIF 自动回填（spec §3）：读的是压缩前原始 asset（pickImages exif:true）；
    // 仅地点草稿完全为空时写入（P5 偏差 2）；非用户动作，不置 placeTouched
    this.ingestExif(kept);
    let rejected = 0;
    const ready: ReadyImage[] = [];
    try {
      this.progressLabel = '压缩中…';
      for (const img of kept) {
        const r = await compressImage(img);
        if (r.size > MAX_IMAGE_BYTES) {
          rejected += 1; // 压缩后仍超限的个别图片（极端长图）跳过；常量唯一来源 @moment/dto
          continue;
        }
        ready.push(r);
      }
    } finally {
      this.progressLabel = null;
    }
    this.images = this.edit ? [...this.images, ...ready] : [...this.images, ...ready].slice(0, cap);
    if (this.edit) this.mediaTouched = true;
    return rejected;
  }

  /** 选视频 + 校验；返回问题文案（null = 成功）。覆盖选择即丢弃上一支视频的封面草稿并重新截帧。 */
  async chooseVideo(): Promise<string | null> {
    if (this.edit) return null;
    const picked = await pickVideo();
    if (!picked) return null;
    const problem = validateVideo(picked);
    if (problem) return problem;
    this.video = picked;
    this.resetPoster();
    void this.capturePoster(picked.uri);
    return null;
  }

  /** 首帧截帧；失败静默降级为无封面发布（spec §4：封面是增强不是门槛） */
  private async capturePoster(videoUri: string): Promise<void> {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0 });
      // 异步返回时视频已更换则丢弃（防串视频）
      if (this.video?.uri === videoUri) this.poster = { uri };
    } catch {
      // 保持 poster = null → 无封面发布
    }
  }

  /** 组件侧置空视频（类型切换 SegmentBar / 「移除」按钮）统一入口：同时丢弃封面草稿 */
  clearVideo(): void {
    this.video = null;
    this.resetPoster();
  }

  private resetPoster(): void {
    this.poster = null;
    this.posterMediaId = null;
  }

  /** 录音组件回调；draft 为 null = 移除重录 */
  setVoice(draft: VoiceDraft | null): void {
    if (this.edit) return;
    this.voice = draft;
  }

  removeKeptMedia(id: string): void {
    this.keptMedia = this.keptMedia.filter((m) => m.id !== id);
    this.mediaTouched = true;
  }

  removeImage(index: number): void {
    this.images = this.images.filter((_, i) => i !== index);
    if (this.edit) this.mediaTouched = true;
  }

  clearImages(): void {
    this.images = [];
    if (this.edit) this.mediaTouched = true;
  }

  /** 组件侧清空语音（类型切换 SegmentBar 统一入口，与 clearVideo 同范式） */
  clearVoice(): void {
    this.voice = null;
  }

  toggleTag(id: string): void {
    this.tagIds = this.tagIds.includes(id) ? this.tagIds.filter((t) => t !== id) : [...this.tagIds, id];
  }

  /** 拉链 person 词典 + 成员（选择器数据源）。失败静默：辅助输入不阻塞发布主流程
   *  （P5 偏差 12，对齐 loadManifest 失败静默先例）。
   *  两路独立成败（allSettled）：词典与成员来自两个接口，词典失败只清词典，不牵连成员置顶。 */
  async loadPersons(): Promise<void> {
    const chainId = this.activeChainId;
    if (!chainId) {
      this.personList = [];
      this.members = [];
      return;
    }
    const [res, members] = await Promise.allSettled([
      client.listPersons(chainId),
      client.listMembers(chainId),
    ]);
    if (this.activeChainId !== chainId) return; // 异步返回时链已切换则丢弃（防串链，对齐 loadManifest 守卫）
    this.personList = res.status === 'fulfilled' ? res.value.persons : [];
    this.members = members.status === 'fulfilled' ? members.value : [];
  }

  /** 词典行 → PersonBrief（词典行无 source；选中态语义恒 manual，spec §6 提交即 manual 意图）。 */
  private asBrief(person: PersonResponse | PersonBrief): PersonBrief {
    return 'source' in person ? person : { ...person, source: 'manual' };
  }

  /** 人物增删切换；置 personsTouched——动作级判脏（P5 偏差 3，见字段注释）。 */
  togglePerson(person: PersonBrief): void {
    this.personsTouched = true;
    this.selectedPersons = this.selectedPersons.some((p) => p.id === person.id)
      ? this.selectedPersons.filter((p) => p.id !== person.id)
      : [...this.selectedPersons, person];
  }

  /** 选中链成员 = 以该用户建/复用 person（spec §7；P5 偏差 7）：词典/已选集有 userId 命中
   *  直接选；否则幂等 POST（P2 契约：撞名归一化返回已存在行）。失败抛出，组件 Alert humanError。 */
  async toggleMember(member: ChainMemberDto): Promise<void> {
    const existing =
      this.personList.find((p) => p.userId === member.userId) ??
      this.selectedPersons.find((p) => p.userId === member.userId);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      return;
    }
    const chainId = this.activeChainId;
    if (!chainId) return;
    const person = await client.createPerson(chainId, { name: member.nickname, userId: member.userId });
    if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
    this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
  }

  /** 词典同名命中直接选（不 POST）；否则自由文本回车新建（幂等 POST，spec §6/§7）。
   *  失败抛出，组件 Alert humanError。 */
  async submitPersonQuery(): Promise<void> {
    const name = this.personQuery.trim();
    const chainId = this.activeChainId;
    if (!name || !chainId) return;
    const existing =
      this.personList.find((p) => p.name === name) ?? this.selectedPersons.find((p) => p.name === name);
    if (existing) {
      this.togglePerson(this.asBrief(existing));
      this.personQuery = '';
      return;
    }
    const person = await client.createPerson(chainId, { name });
    if (!this.personList.some((p) => p.id === person.id)) this.personList = [...this.personList, person];
    this.togglePerson({ id: person.id, name: person.name, userId: person.userId, source: 'manual' });
    this.personQuery = '';
  }

  setPlaceName(name: string): void {
    this.placeTouched = true;
    this.placeName = name;
  }

  /** 移除 EXIF chip（spec §3「可点 × 移除」）：丢弃坐标且本面板会话不再自动回填（P5 偏差 2）。 */
  removePlaceCoords(): void {
    this.placeTouched = true;
    this.exifDismissed = true;
    this.placeCoords = null;
  }

  /** 发生时间是否被改过（spec §2 判断式：还原成墙钟毫秒再比，不能直接比 getTime()）。 */
  private get timeEdited(): boolean {
    if (!this.edit) return false;
    return this.happenedAt.getTime() - this.editDeviceOffset * 60_000 !== this.editWallMs;
  }

  /** picker 变更入口：编辑态按「记录时区还原的真实毫秒」重算补发标记（对齐 web：abs > 5min，未来也算补发）；
   *  新建态沿用原有本地毫秒口径。 */
  onHappenedAtChange(d: Date): void {
    this.happenedAt = d;
    if (this.edit) {
      const newMs = d.getTime() - this.editDeviceOffset * 60_000 + this.edit.happenedTzOffset * 60_000;
      this.isBackfill = Math.abs(newMs - Date.now()) > 5 * 60_000;
    } else {
      this.isBackfill = d.getTime() < Date.now() - 10 * 60_000;
    }
  }

  /** EXIF 自动回填守卫（spec §3，P5 偏差 2 同款）：已移除 chip / 已有坐标 / 已手动输入
   *  地点名任一命中即短路。多图取第一张含 GPS 的（firstAssetGps）。 */
  private ingestExif(assets: { exif?: Record<string, unknown> | null }[]): void {
    if (this.exifDismissed || this.placeCoords || this.placeName.trim() !== '') return;
    const coords = firstAssetGps(assets);
    if (coords) this.placeCoords = coords;
  }

  /** place 提交形态（spec §6 赋值表在 server 判 source，客户端只交 name/坐标）：
   *  名字（trim 后，P5 偏差 5）与坐标皆空 → null（显式清除）；有坐标 ±名字 → 整体提交
   *  （坐标+名字 → manual「确认后的形态」；仅坐标 → exif）；仅名字 → {name}（manual 文本）。
   *  P5 偏差 4：改过名字坐标随行——仅提交名字会触发「仅名字 → manual 且坐标清空」，丢数据更差。 */
  private placePayload(): { name?: string; lat?: number; lng?: number } | null {
    const name = this.placeName.trim();
    if (name === '' && !this.placeCoords) return null;
    return this.placeCoords
      ? { ...(name !== '' ? { name } : {}), lat: this.placeCoords.lat, lng: this.placeCoords.lng }
      : { name };
  }

  /** 提交：编辑态走 PATCH（submitEdit）；新建态串行上传（进度聚合）→ createMoment → emit。
   *  前置校验失败抛 Error（中文 message）。 */
  async submit(): Promise<void> {
    if (this.selectedPersons.length > 20) throw new Error('最多关联 20 位人物');
    if (this.edit) return this.submitEdit();
    const activeChainId = this.activeChainId;
    if (!activeChainId) throw new Error('请选择要发布到的链（需要编辑权限）');
    // 角色前置校验：viewer 链（含深链/旧参数）挡在媒体上传之前，避免全量上传后才被服务端 403
    if (!this.editableChains.some((c) => c.id === activeChainId)) throw new Error('请选择要发布到的链（需要编辑权限）');
    // kind moment 允许无正文（结构化字段即内容，正文由摘要兜底）；standard 维持原校验
    if (this.type === 'text' && this.content.trim().length === 0 && this.kind === 'standard') throw new Error('文字类型需要内容');
    if (this.kind !== 'standard' && this.content.trim().length === 0 && this.type === 'text') {
      const s = summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft);
      if (!s) throw new Error('选一项或写一句，再发布');
    }
    if (this.content.length > 5000) throw new Error('正文最多 5000 字');
    if (this.type === 'media' && this.images.length === 0) throw new Error('图文类型至少选 1 张图（最多 9 张）');
    if (this.type === 'video' && !this.video) throw new Error('视频类型需要先选择视频');
    if (this.type === 'voice' && !this.voice) throw new Error('语音类型需要先录音');

    // 图片走 file: Blob（压缩后百 KB 级，已在内存）；视频/语音走 fileUri 形态——rnPut 按 part
    // 从文件 uri 读盘 PUT，大文件整体不进内存（见 src/lib/rn-put.ts）。
    const mediaIds: string[] = [];
    type UploadFile =
      | { file: Blob; mime: string; size: number; kind: 'image'; sortOrder: number }
      | { fileUri: string; mime: string; size: number; kind: 'video'; durationSeconds: number; sortOrder: number }
      | { fileUri: string; mime: string; size: number; kind: 'audio'; durationSeconds: number; sortOrder: number };
    let files: UploadFile[] = [];
    if (this.type === 'media') {
      files = this.images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i }));
    } else if (this.type === 'video' && this.video) {
      files = [{ fileUri: this.video.uri, mime: this.video.mime, size: this.video.size, kind: 'video' as const, durationSeconds: this.video.durationSeconds, sortOrder: 0 }];
    } else if (this.type === 'voice' && this.voice) {
      // 语音在前（mediaIds[0] = audio），附图随后；fileUri 形态按 FilePart 读盘，整文件不进内存
      files = [
        { fileUri: this.voice.uri, mime: this.voice.mime, size: this.voice.size, kind: 'audio' as const, durationSeconds: this.voice.durationSeconds, sortOrder: 0 },
        ...this.images.map((img, i) => ({ file: img.blob, mime: img.mime, size: img.size, kind: 'image' as const, sortOrder: i + 1 })),
      ];
    }
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    let doneBytes = 0;
    try {
      for (const f of files) {
        const res = await uploadWithRetry({
          ...f,
          onProgress: (loaded) => {
            const overall = totalBytes > 0 ? Math.floor(((doneBytes + loaded) / totalBytes) * 100) : 100;
            this.progressLabel = `上传中 ${overall}%`;
          },
        });
        mediaIds.push(res.mediaId);
        doneBytes += f.size;
      }

      if (this.type === 'video' && this.poster && !this.posterMediaId) {
        try {
          const blob = await uriToBlob(this.poster.uri);
          const res = await uploadWithRetry({ file: blob, mime: 'image/jpeg', size: blob.size, kind: 'image' });
          this.posterMediaId = res.mediaId;
        } catch {
          this.posterMediaId = null; // 封面上传失败降级为无封面发布
        }
      }

      this.progressLabel = '发布中…';
      const created = await client.createMoment(activeChainId, {
        type: this.type,
        content:
          this.content.trim().length === 0 && this.kind !== 'standard'
            ? summarizePayload(this.manifest ?? { version: 1 }, this.kind, this.payloadDraft)
            : this.content,
        happenedAt: this.happenedAt.toISOString(),
        // 与 dto 契约同语义：原值（同 JS getTimezoneOffset，东八区 = -480），不取反
        happenedTzOffset: this.happenedAt.getTimezoneOffset(),
        isBackfill: this.isBackfill,
        mediaIds,
        tagIds: this.tagIds,
        kind: this.kind,
        ...(this.posterMediaId ? { posterMediaId: this.posterMediaId } : {}),
        ...(Object.keys(this.payloadDraft).length > 0 ? { payload: this.payloadDraft } : {}),
        // 人物/地点（spec people-place §6）：create 无 dirty 语义，选中即提交；
        // EXIF 坐标未动过也照常上送（落 exif 分支，name 由 geocode 异步回填）
        ...(this.selectedPersons.length > 0 ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
        ...(this.placeTouched || this.placeCoords ? { place: this.placePayload() } : {}),
      });
      this.emit('moment:changed', { momentId: created.id, chainId: activeChainId, op: 'create' }, 'global');
    } finally {
      this.progressLabel = null; // 失败路径也复位，避免「上传中 N%」「发布中…」永久停留
    }
  }

  /** 编辑提交：patch 基础 { content, tagIds }；时间被改过才传 happenedAt
   *  （按记录时区还原 ISO）并重算 isBackfill。仅 mediaTouched 时串行 upload 新图再带 mediaIds；不传 type / posterMediaId。 */
  private async submitEdit(): Promise<void> {
    const edit = this.edit;
    if (!edit) return;
    const resultCount = this.keptMedia.length + this.images.length;
    if (edit.type === 'text' && resultCount === 0 && edit.kind === 'standard' && this.content.trim().length === 0) {
      throw new Error('文字类型需要内容');
    }
    if (edit.type === 'media' && resultCount === 0) throw new Error('至少留一张图');
    if (this.mediaTouched && this.keptMedia.some((m) => m.mime.startsWith('video/'))) {
      throw new Error('改图片前请先移除宫格里的视频');
    }
    if (edit.type === 'voice' && !this.keptAudio) throw new Error('录音不能换');
    if (this.content.length > 5000) throw new Error('正文最多 5000 字');

    const patch: PatchMomentInput = {
      content: this.content,
      tagIds: this.tagIds,
      kind: edit.kind,
      payload: Object.keys(this.payloadDraft).length > 0 ? this.payloadDraft : null,
      // dirty tracking（spec §6，P5 偏差 3/4 同款）：undefined = 不变——未动过的人物/地点
      // 绝不整包回传（否则 ai 行被静默升级 manual、exif place 误升级 manual，spec §6 警告）
      ...(this.personsTouched ? { personIds: this.selectedPersons.map((p) => p.id) } : {}),
      ...(this.placeTouched ? { place: this.placePayload() } : {}),
    };
    if (this.timeEdited) {
      // 还原：newWallMs = picker − deviceOffset；iso = newWallMs + 记录时区偏移（spec 公式）
      const newWallMs = this.happenedAt.getTime() - this.editDeviceOffset * 60_000;
      const newMs = newWallMs + edit.happenedTzOffset * 60_000;
      patch.happenedAt = new Date(newMs).toISOString();
      // 对齐 web compose-panel：未来时间也算补发（review I4）
      patch.isBackfill = Math.abs(newMs - Date.now()) > 5 * 60_000;
    }

    try {
      if (this.mediaTouched) {
        const uploaded: string[] = [];
        for (const img of this.images) {
          this.progressLabel = '上传中…';
          const res = await uploadWithRetry({
            file: img.blob,
            mime: img.mime,
            size: img.size,
            kind: 'image',
          });
          uploaded.push(res.mediaId);
        }
        const rest = [...this.keptMedia.map((m) => m.id), ...uploaded];
        patch.mediaIds = edit.type === 'voice' && this.keptAudio ? [this.keptAudio.id, ...rest] : rest;
      }
      this.progressLabel = '保存中…';
      await client.updateMoment(edit.id, patch);
      this.emit('moment:changed', { momentId: edit.id, chainId: edit.chainId, op: 'update' }, 'global');
    } finally {
      this.progressLabel = null;
    }
  }
}
