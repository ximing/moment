import {
  CHAIN_COLORS,
  type ChainAppearanceColor,
  type ChainColor,
  type ChainImageFocus,
  type CreateChainInput,
  type UpdateChainInput,
} from '@moment/dto';
import { BadRequestError } from 'routing-controllers';
import type { Chain } from '../db/schema.js';

/** 焦点居中值（数据库 0..10000 整数域的中点，对应 API 0..1 的 0.5）。 */
const CENTER = 5000;

/** 与 apps/web/src/lib/chain-color.ts 相同的 FNV-1a：同一 chainId 两端哈希色一致。 */
function fnv1a(chainId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chainId.length; i++) {
    h ^= chainId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 未选色时的服务端默认色：按 chainId 哈希取预设色，同一链恒定。 */
export function defaultChainColor(chainId: string): ChainColor {
  return CHAIN_COLORS[fnv1a(chainId) % CHAIN_COLORS.length]!;
}

/** API 焦点（0..1）→ 数据库存储（0..10000 int，四舍五入，避免浮点序列化/比较误差）。 */
export function focusToDb(focus: ChainImageFocus): { x: number; y: number } {
  return { x: Math.round(focus.x * 10000), y: Math.round(focus.y * 10000) };
}

/** 数据库焦点（0..10000 int）→ API 焦点（0..1）。 */
export function focusFromDb(x: number, y: number): ChainImageFocus {
  return { x: x / 10000, y: y / 10000 };
}

/**
 * 链视觉字段的数据库 patch。键出现 = 要写入；undefined = 不动。
 * 三模式互斥不变量（设计 §3.1）：图片 avatarMediaId 非空 / Emoji icon 非空 / 纯色 color 非空，
 * 三者恰居其一；本模块负责维持，不信任客户端只传一个字段。
 */
export interface ChainAppearancePatch {
  avatarMediaId?: string | null;
  icon?: string | null;
  color?: string | null;
  avatarFocusX?: number;
  avatarFocusY?: number;
  coverMediaId?: string | null;
  coverFocusX?: number;
  coverFocusY?: number;
}

function assertAvatarCoverDistinct(avatarMediaId: string | null, coverMediaId: string | null): void {
  if (avatarMediaId !== null && avatarMediaId === coverMediaId) {
    throw new BadRequestError('CHAIN_MEDIA_DUPLICATED');
  }
}

/**
 * 创建归一化：优先级 avatarMediaId > icon > color > defaultColor（设计 §3.1/§4.2）。
 * 旧客户端 color+icon 组合按 Emoji 优先归一化（存 icon，清 color）。
 * dto 层已拒 avatarMediaId 与非空 color/icon 混传；此处优先级兜底。
 * 返回全量列值（创建没有「不动」语义）。
 */
export function normalizeCreateAppearance(
  chainId: string,
  input: CreateChainInput,
): Required<ChainAppearancePatch> {
  let avatarMediaId: string | null = null;
  let icon: string | null = null;
  let color: ChainAppearanceColor | null = null;
  let avatarFocus = focusToDb({ x: 0.5, y: 0.5 });

  if (input.avatarMediaId != null) {
    avatarMediaId = input.avatarMediaId;
    if (input.avatarFocus != null) avatarFocus = focusToDb(input.avatarFocus);
  } else if (input.icon != null) {
    icon = input.icon;
  } else if (input.color != null) {
    color = input.color;
  } else {
    // 三者全空：按 id 哈希选定预设色并持久化，新数据仍满足互斥不变量
    color = defaultChainColor(chainId);
  }

  const coverMediaId = input.coverMediaId ?? null;
  const coverFocus = focusToDb(input.coverFocus ?? { x: 0.5, y: 0.5 });
  assertAvatarCoverDistinct(avatarMediaId, coverMediaId);

  return {
    avatarMediaId,
    icon,
    color,
    avatarFocusX: avatarFocus.x,
    avatarFocusY: avatarFocus.y,
    coverMediaId,
    coverFocusX: coverFocus.x,
    coverFocusY: coverFocus.y,
  };
}

/**
 * 更新归一化（设计 §4.2）：
 * - 任一非空选择器（avatarMediaId/icon/color）出现即切到该模式，清空另外两个字段，焦点重置居中
 *   （同 id 幂等重存保留/应用焦点，由 focus 入参与当前行决定）；
 * - 当前模式字段显式 null 且无新模式 → 回退到服务端选定的默认纯色（持久化）；
 * - avatarFocus 单独调整要求当前是图片模式，否则 CHAIN_AVATAR_FOCUS_INVALID；
 * - coverMediaId:null 删除封面并把焦点重置为中心；coverFocus 单独调整要求当前有封面，
 *   否则 CHAIN_COVER_FOCUS_INVALID；
 * - 结果态头像与封面不得引用同一 media，否则 CHAIN_MEDIA_DUPLICATED。
 */
export function normalizeUpdateAppearance(
  chainId: string,
  current: Chain,
  input: UpdateChainInput,
): ChainAppearancePatch {
  const patch: ChainAppearancePatch = {};

  const avatarTouched =
    input.avatarMediaId !== undefined ||
    input.icon !== undefined ||
    input.color !== undefined ||
    input.avatarFocus !== undefined;

  if (avatarTouched) {
    if (input.avatarMediaId != null) {
      // 切图片模式；同 id 幂等：未给焦点时保留当前焦点，新图默认居中
      patch.avatarMediaId = input.avatarMediaId;
      patch.icon = null;
      patch.color = null;
      const focus =
        input.avatarFocus ??
        (input.avatarMediaId === current.avatarMediaId
          ? focusFromDb(current.avatarFocusX, current.avatarFocusY)
          : { x: 0.5, y: 0.5 });
      const f = focusToDb(focus);
      patch.avatarFocusX = f.x;
      patch.avatarFocusY = f.y;
    } else if (input.icon != null || input.color != null) {
      // 切 Emoji / 纯色模式（旧 color+icon 组合 icon 优先，color 被清）
      patch.avatarMediaId = null;
      patch.icon = input.icon != null ? input.icon : null;
      patch.color = input.icon != null ? null : (input.color ?? null);
      patch.avatarFocusX = CENTER;
      patch.avatarFocusY = CENTER;
      // 焦点无处安放：新模式不是图片，随模式切换提交的 avatarFocus 一律拒绝
      if (input.avatarFocus != null) throw new BadRequestError('CHAIN_AVATAR_FOCUS_INVALID');
    } else {
      // 无非空选择器：显式 null 清当前模式 → 默认纯色；否则按 no-op/焦点单独调整处理
      const clearsCurrentImage = input.avatarMediaId === null && current.avatarMediaId !== null;
      const clearsCurrentEmoji =
        input.icon === null && current.avatarMediaId === null && current.icon !== null;
      if (clearsCurrentImage || clearsCurrentEmoji) {
        if (input.avatarFocus != null) throw new BadRequestError('CHAIN_AVATAR_FOCUS_INVALID');
        patch.avatarMediaId = null;
        patch.icon = null;
        patch.color = defaultChainColor(chainId);
        patch.avatarFocusX = CENTER;
        patch.avatarFocusY = CENTER;
      } else {
        if (input.avatarMediaId === null) patch.avatarMediaId = null; // 当前非图片：no-op 清理
        if (input.icon === null) patch.icon = null;
        if (input.avatarFocus != null) {
          if (current.avatarMediaId === null) throw new BadRequestError('CHAIN_AVATAR_FOCUS_INVALID');
          const f = focusToDb(input.avatarFocus);
          patch.avatarFocusX = f.x;
          patch.avatarFocusY = f.y;
        }
      }
    }
  }

  if (input.coverMediaId !== undefined || input.coverFocus !== undefined) {
    if (input.coverMediaId != null) {
      patch.coverMediaId = input.coverMediaId;
      const focus =
        input.coverFocus ??
        (input.coverMediaId === current.coverMediaId
          ? focusFromDb(current.coverFocusX, current.coverFocusY)
          : { x: 0.5, y: 0.5 });
      const f = focusToDb(focus);
      patch.coverFocusX = f.x;
      patch.coverFocusY = f.y;
    } else if (input.coverMediaId === null) {
      // 删除封面：焦点重置为中心（设计 §4.2）
      patch.coverMediaId = null;
      patch.coverFocusX = CENTER;
      patch.coverFocusY = CENTER;
    } else if (input.coverFocus != null) {
      if (current.coverMediaId === null) throw new BadRequestError('CHAIN_COVER_FOCUS_INVALID');
      const f = focusToDb(input.coverFocus);
      patch.coverFocusX = f.x;
      patch.coverFocusY = f.y;
    }
  }

  // 结果态查重：头像与封面不得引用同一 media（含「新封面 = 当前头像」这类跨 placement 冲突）
  const resultAvatar = patch.avatarMediaId !== undefined ? patch.avatarMediaId : current.avatarMediaId;
  const resultCover = patch.coverMediaId !== undefined ? patch.coverMediaId : current.coverMediaId;
  assertAvatarCoverDistinct(resultAvatar, resultCover);

  return patch;
}
