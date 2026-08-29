import { z } from 'zod';
import type { ReactionSummary } from './comments.js';
import type { TagBrief } from './tags.js';
import { isoDatetime, uuidLoose } from './feed.js';
import { momentPersonIdsSchema, placeInputSchema, type MomentPlace, type PersonBrief } from './persons.js';

export const momentTypeSchema = z.enum(['text', 'media', 'video', 'voice']);
export type MomentType = z.infer<typeof momentTypeSchema>;

const uuidSchema = z.string().uuid();
export const momentTagIdsSchema = z.array(uuidSchema).max(20);

const isoTimestampSchema = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'INVALID_TIMESTAMP' });

export const createMomentInputSchema = z
  .object({
    type: momentTypeSchema,
    content: z.string().max(5000).default(''),
    happenedAt: isoTimestampSchema,
    /** 提交时时区偏移（分钟，东八区为 -480，语义同 JS getTimezoneOffset），供展示（spec §5.6） */
    happenedTzOffset: z.number().int().min(-840).max(840),
    isBackfill: z.boolean().default(false),
    mediaIds: z.array(z.string().min(1)).default([]),
    /** 视频封面媒体 id（客户端截帧的普通 image 上传）；仅 type=video 可传，见 superRefine */
    posterMediaId: z.string().min(1).optional(),
    tagIds: momentTagIdsSchema.optional(),
    /** 关联人物（spec §6）：提交即 manual 意图，server 做属链校验；create 缺省 = 无关联 */
    personIds: momentPersonIdsSchema.optional(),
    /** 地点（spec §6）：source 由 server 按赋值表判定（客户端不传 source）；create 上 null 等价未传（无既有状态可清除） */
    place: placeInputSchema.nullable().optional(),
    /** 语义类别（spec §1.1）；standard = 普通 moment，其余由链模板 kinds 声明 */
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64).default('standard'),
    /** 结构化数据；standard moment 只允许模板 momentFields 声明的 key，kind moment 按 kind 的 payloadSchema（server 校验） */
    payload: z.record(z.unknown()).nullish(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'text') {
      if (val.content.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CONTENT_REQUIRED', path: ['content'] });
      }
      if (val.mediaIds.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_NOT_ALLOWED', path: ['mediaIds'] });
      }
    }
    if (val.type === 'video' && val.mediaIds.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    if (val.type === 'media' && (val.mediaIds.length < 1 || val.mediaIds.length > 9)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    // voice = 1 语音 + 0~8 附图（dto 只验数量与去重；「恰好 1 条 audio/* 且其余全 image/*」
    // 的 mime 构成校验在 server 发布事务内做，与 video/media 同分工，spec §2.2）
    if (val.type === 'voice' && (val.mediaIds.length < 1 || val.mediaIds.length > 9)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    // 重复 id 会导致发布事务对同一 tmp 对象 copy 两次（第二次 NoSuchKey → 500），必须拒绝
    if (val.type !== 'text' && new Set(val.mediaIds).size !== val.mediaIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    // 封面仅单视频支持（spec video-poster §1：宫格视频封面语义 YAGNI）
    if (val.type !== 'video' && val.posterMediaId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_NOT_ALLOWED', path: ['posterMediaId'] });
    }
  });
export type CreateMomentInput = z.infer<typeof createMomentInputSchema>;

export const patchMomentInputSchema = z
  .object({
    content: z.string().max(5000).optional(),
    happenedAt: isoTimestampSchema.optional(),
    happenedTzOffset: z.number().int().min(-840).max(840).optional(),
    isBackfill: z.boolean().optional(),
    tagIds: momentTagIdsSchema.optional(),
    /**
     * PATCH 全量替换（与 tagIds 对齐，spec §6）：提交的集合写 source=manual，
     * 集合外原有行（manual 与 ai 一并）删除；空数组 [] = 清空全部人物。缺省 undefined = 不变——
     * 客户端 dirty tracking：仅用户实际增删过人物才提交本字段（否则整包回传会把 ai 行静默升级 manual）。
     */
    personIds: momentPersonIdsSchema.optional(),
    /**
     * PATCH 语义（spec §6）：undefined = 不变（dirty tracking：仅用户实际改过地点才提交）；
     * null = 显式清除 place 三列 + place_source；
     * 对象 = server 按赋值表定 source（坐标+名字→manual / 仅坐标→exif / 仅名字→manual）。
     */
    place: placeInputSchema.nullable().optional(),
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/).max(64).optional(),
    payload: z.record(z.unknown()).nullable().optional(),
    /**
     * PATCH 全量替换内容媒体（与 tagIds / personIds 对齐）：
     * undefined = 不变；提交数组 = 新集合（可 []）。数量/mime 构成在 server 按原 type 判。
     * 元素必须是 uuid（比 create 的 z.string().min(1) 更严；create 不改）。
     */
    mediaIds: z.array(z.string().uuid()).optional(),
    /**
     * 封面。dto 放行（含 null）以便 server 抛 MEDIA_NOT_ALLOWED；
     * 本字段任意有值（uuid 或 null）都不改 poster 行。
     */
    posterMediaId: z.string().uuid().nullable().optional(),
  })
  .strict() // 未知键（含 type）直接 VALIDATION_ERROR，而非静默剥离
  .superRefine((val, ctx) => {
    if (val.mediaIds === undefined) return;
    if (new Set(val.mediaIds).size !== val.mediaIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
    if (val.mediaIds.length > 9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MEDIA_COUNT_INVALID', path: ['mediaIds'] });
    }
  })
  .refine((val) => Object.values(val).some((v) => v !== undefined), { message: 'EMPTY_PATCH' });
export type PatchMomentInput = z.infer<typeof patchMomentInputSchema>;
export const updateMomentInputSchema = patchMomentInputSchema;
export type UpdateMomentInput = PatchMomentInput;

/** moment 响应中的媒体：只出稳定入口相对路径，不内嵌预签名 URL（CONVENTIONS §3.4） */
export interface MomentMedia {
  id: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sortOrder: number;
  /** 视频封面媒体 id：登录态经 useMediaObjectUrl / useMediaUri(posterMediaId) 取 blob；仅视频行非空，无封面为 null */
  posterMediaId: string | null;
  /** 视频封面稳定入口相对路径 /api/media/:posterId（不内嵌预签名 URL，CONVENTIONS §3.4）；分享态拼 ?st= 用；仅视频行非空，无封面为 null */
  posterUrl: string | null;
  /**
   * 派生图稳定入口 `/api/media/:id?variant=derived`；仅 derived_status=ready 非空。
   * 不内嵌预签名（CONVENTIONS §3.4）。
   */
  derivedUrl: string | null;
  /**
   * 视频封面派生入口 `/api/media/:posterId?variant=derived`；仅视频行且封面 derived_status=ready 非空，否则 null。
   * 图片行恒 null。
   */
  posterDerivedUrl: string | null;
}

export interface AuthorSummary {
  id: string;
  nickname: string;
  /** 头像预签名 URL；无头像为 null。与 UserProfile.avatarUrl 同语义 */
  avatarUrl: string | null;
}

export interface MomentResponse {
  id: string;
  chainId: string;
  author: AuthorSummary;
  type: MomentType;
  content: string;
  /** ASR 原始转写；仅 voice 可能非空，其余类型恒 null（用户不可改，PATCH .strict() 拒绝） */
  transcript: string | null;
  /** 转写状态；仅 voice 非空（pending/done/failed），其余类型恒 null */
  transcriptionStatus: 'pending' | 'done' | 'failed' | null;
  /** 语义类别（默认 standard） */
  kind: string;
  /** 结构化数据（milestone/metric 的 payload，或 standard 的 mood/geo 等扩展字段）；无为 null */
  payload: Record<string, unknown> | null;
  happenedAt: string;
  happenedTzOffset: number;
  isBackfill: boolean;
  createdAt: string;
  media: MomentMedia[];
  /** moment 上的标签（同一 moment 内按 tagId 升序——确定性排序，非插入顺序） */
  tags: TagBrief[];
  /**
   * moment 上的人物（含 AI 抽取行；source 取自 moment_persons 关联行）。
   * 链内路径（serializeMoments 传 includePrivate:true）必产出；公开分享路径的
   * PublicShareMoment 不含本字段（spec §8 红线，P1 偏差 2 由 P2 收口为必填）。
   */
  persons: PersonBrief[];
  /** 地点；无地点为 null。链内路径必产出；公开分享路径不含（spec §8 红线）。 */
  place: MomentPlace | null;
  /** 未软删评论数（批量 GROUP BY 产出） */
  commentCount: number;
  /** 按 emoji 分组的表情计数 */
  reactions: ReactionSummary[];
  /** 当前请求用户在本 moment 上点的 emoji；未点/无 viewer 上下文为 null */
  myReaction: string | null;
}

export interface MomentListResponse {
  items: MomentResponse[];
  nextCursor: string | null;
}

/** 链内列表 query：cursor 空串/超长走 VALIDATION_ERROR；limit 仍由 service 解析为 INVALID_LIMIT。 */
export const listMomentsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.string().optional(),
    /** 日期锚定（spec §4.2）：happened_at < before；链内列表恒 happened_at 语义，天然可用 */
    before: isoTimestampSchema.optional(),
    person_id: z.string().regex(uuidLoose).optional(),
    place: z.string().trim().min(1).max(255).optional(),
    happened_from: isoDatetime.optional(),
    happened_to: isoDatetime.optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.happened_from !== undefined &&
      val.happened_to !== undefined &&
      Date.parse(val.happened_from) > Date.parse(val.happened_to)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['happened_to'] });
    }
  });
export type ListMomentsQuery = z.infer<typeof listMomentsQuerySchema>;

