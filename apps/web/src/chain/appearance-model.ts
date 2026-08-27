import type {
  ChainAppearanceColor,
  ChainDto,
  ChainIcon,
  ChainImageFocus,
} from '@moment/dto';

// 链外观草稿模型（spec §3/§4.2、plan Task 7）：
// - 头像三模式互斥（emoji / image / color），草稿只保留新模式值；
// - 封面独立于头像，不参互斥；
// - DTO 水合采取防御性优先级 avatarMediaId > icon > color（与服务端读取一致）；
// - 焦点始终归一化 [0,1]，居中为 (0.5, 0.5)。

export type ChainAvatarMode = 'emoji' | 'image' | 'color';

export type ChainImageStatus = 'ready' | 'uploading' | 'error';

/** 单张链图片（头像或封面）的草稿状态。 */
export interface ChainImageDraft {
  /** 已分配的服务端 media id；presign 成功即存在（完成前也不可提交） */
  mediaId: string | null;
  /** 预览来源：持久化资源为稳定 media URL，本地上传中为 object URL */
  src: string | null;
  focus: ChainImageFocus;
  /** true = 已随链保存过的既有资源；false = 本次会话的临时上传（切换/卸载需 discard） */
  persisted: boolean;
  status: ChainImageStatus;
  /** 0–100，仅 uploading 有意义 */
  progress: number;
  /** status=error 时的可读错误文案 */
  error: string | null;
  fileName: string | null;
}

export interface ChainAppearanceDraft {
  avatarMode: ChainAvatarMode;
  /** avatarMode=color 时的值；其余模式为 null */
  color: ChainAppearanceColor | null;
  /** avatarMode=emoji 时的值；其余模式为 null */
  icon: ChainIcon | null;
  /** avatarMode=image 时的图片草稿；其余模式为 null */
  avatar: ChainImageDraft | null;
  /** 封面独立于头像模式；null = 无封面 */
  cover: ChainImageDraft | null;
}

export const CENTER_FOCUS: ChainImageFocus = { x: 0.5, y: 0.5 };

function persistedImage(
  mediaId: string,
  src: string,
  focus: ChainImageFocus | null,
): ChainImageDraft {
  return {
    mediaId,
    src,
    focus: focus ?? CENTER_FOCUS,
    persisted: true,
    status: 'ready',
    progress: 0,
    error: null,
    fileName: null,
  };
}

/** ChainDto → 草稿（防御性优先级 image > icon > color；缺 color 由展示层按 id 哈希回退）。 */
export function appearanceDraftFromChain(chain: ChainDto): ChainAppearanceDraft {
  let avatarMode: ChainAvatarMode = 'color';
  let color: ChainAppearanceColor | null = null;
  let icon: ChainIcon | null = null;
  let avatar: ChainImageDraft | null = null;

  if (chain.avatarMediaId !== null && chain.avatarUrl !== null) {
    avatarMode = 'image';
    avatar = persistedImage(chain.avatarMediaId, chain.avatarUrl, chain.avatarFocus);
  } else if (chain.icon !== null) {
    avatarMode = 'emoji';
    icon = chain.icon;
  } else {
    avatarMode = 'color';
    color = chain.color;
  }

  // 与 DTO 契约一致：URL/focus 不成组的 cover id 不可安全复用，视为无封面
  const cover =
    chain.coverMediaId !== null && chain.coverUrl !== null
      ? persistedImage(chain.coverMediaId, chain.coverUrl, chain.coverFocus)
      : null;

  return { avatarMode, color, icon, avatar, cover };
}

/** 外观字段子集：create/update 共用（其余字段如 name/template 由调用方补齐）。 */
export interface ChainAppearanceInput {
  color?: ChainAppearanceColor | null;
  icon?: ChainIcon | null;
  avatarMediaId?: string | null;
  avatarFocus?: ChainImageFocus;
  coverMediaId?: string | null;
  coverFocus?: ChainImageFocus;
}

function readyMediaId(image: ChainImageDraft | null): string | null {
  return image !== null && image.status === 'ready' ? image.mediaId : null;
}

/**
 * 草稿 → create/update 外观 payload：
 * - 恰好一个头像模式激活，inactive 字段显式 null（服务端据非空选择器切模式）；
 * - 图片模式只提交 ready 且带 mediaId 的图片（上传中视为无图，提交由保存按钮禁用兜底）；
 * - cover 独立：有 ready 图片随附 focus；无封面传 coverMediaId:null 并省略 coverFocus
 *   （Task 1 DTO 拒绝 coverMediaId:null + coverFocus；省略保留删除语义）。
 */
export function appearanceInputFromDraft(draft: ChainAppearanceDraft): ChainAppearanceInput {
  const input: ChainAppearanceInput = {};

  if (draft.avatarMode === 'emoji') {
    input.icon = draft.icon;
    input.color = null;
    input.avatarMediaId = null;
  } else if (draft.avatarMode === 'color') {
    input.icon = null;
    input.color = draft.color;
    input.avatarMediaId = null;
  } else {
    input.icon = null;
    input.color = null;
    const mediaId = readyMediaId(draft.avatar);
    input.avatarMediaId = mediaId;
    if (mediaId !== null) input.avatarFocus = draft.avatar!.focus;
  }

  const coverMediaId = readyMediaId(draft.cover);
  input.coverMediaId = coverMediaId;
  if (coverMediaId !== null) input.coverFocus = draft.cover!.focus;

  return input;
}

/* ---------------------------------------------------------------------------
 * 焦点几何（spec §7.4）：cover 缩放下的拖动位移 → 归一化 object-position。
 * 固定数学（plan Task 7）：
 *   scale = max(vw/iw, vh/ih)
 *   excessX = iw*scale - vw; excessY = ih*scale - vh
 *   x = excessX > 0 ? clamp(start.x - dx/excessX) : 0.5（y 同理）
 * ------------------------------------------------------------------------- */

export interface FocusDragGeometry {
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 拖动（向右/向下为正）换算为新焦点：图片随指针移动意味着可视窗口向反方向
 * 滑动，因此焦点沿 -delta/excess 方向移动；无 overflow 的轴不可定位，回 0.5。
 */
export function shiftFocusForDrag(
  start: ChainImageFocus,
  delta: { deltaX: number; deltaY: number },
  geometry: FocusDragGeometry,
): ChainImageFocus {
  const scale = Math.max(
    geometry.viewportWidth / geometry.imageWidth,
    geometry.viewportHeight / geometry.imageHeight,
  );
  const excessX = geometry.imageWidth * scale - geometry.viewportWidth;
  const excessY = geometry.imageHeight * scale - geometry.viewportHeight;
  const x = excessX > 0 ? clamp01(start.x - delta.deltaX / excessX) : 0.5;
  const y = excessY > 0 ? clamp01(start.y - delta.deltaY / excessY) : 0.5;
  return { x, y };
}

/** 焦点 → CSS object-position 值。 */
export function focusObjectPosition(focus: ChainImageFocus): string {
  return `${focus.x * 100}% ${focus.y * 100}%`;
}
