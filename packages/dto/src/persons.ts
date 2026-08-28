import { z } from 'zod';

// ---------- 来源词表（spec §2：moment_persons.source / moments.place_source） ----------

/** moment_persons.source：manual = 用户手动关联；ai = AI 抽取补缺（spec §2/§5，manual 不降级、ai 仅补缺） */
export const MOMENT_PERSON_SOURCES = ['manual', 'ai'] as const;
export type MomentPersonSource = (typeof MOMENT_PERSON_SOURCES)[number];

/** moments.place_source：优先级 manual > exif > ai（spec §0/§6 赋值表） */
export const PLACE_SOURCES = ['manual', 'exif', 'ai'] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];

// ---------- 请求 schema（spec §6） ----------

/**
 * moment 关联人物 id 集（uuid，max 20，spec §6）。
 * PATCH 语义 = 全量替换（与 tagIds 对齐）：提交的集合写 source=manual，集合外原有行删除；
 * 缺省 undefined = 不变。属链校验（400 PERSON_NOT_IN_CHAIN）是 server 职责。
 */
export const momentPersonIdsSchema = z.array(z.string().uuid()).max(20);
export type MomentPersonIds = z.infer<typeof momentPersonIdsSchema>;

/**
 * 地点输入（spec §6）：
 * - name 可选，string(1..255)（spec 字面，不做 trim——名归一化条款仅约束人物词典名）
 * - lat ∈ [-90, 90]、lng ∈ [-180, 180]（WGS-84，客户端坐标是不可信输入，spec §3）
 * - lat/lng 必须同有同无
 * - name 与坐标至少其一
 * 违反任一规则 → 400 PLACE_COORDS_INVALID。
 * strict：未知键（含 source）拒绝而非静默 strip——source 不在请求契约内：由 server 按赋值表判定
 * （坐标+名字→manual / 仅坐标→exif / 仅名字→manual），防止伪造 source 绕过优先级规则（spec §3 信任边界）。
 */
export const placeInputSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasLat = val.lat !== undefined;
    const hasLng = val.lng !== undefined;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PLACE_COORDS_INVALID',
        path: [hasLat ? 'lng' : 'lat'],
      });
    }
    if (val.name === undefined && !hasLat && !hasLng) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PLACE_COORDS_INVALID' });
    }
  });
export type PlaceInput = z.infer<typeof placeInputSchema>;

/**
 * 新建 person 词典行（POST /api/chains/:chainId/persons，spec §6）。
 * trim 镜像 tagCreateInputSchema；名归一化的「去内部连续空白」在 server 应用层（spec §2），不在 dto。
 * 名归一化撞 uk_persons_chain_name → server 返回已存在行（幂等创建）。
 */
export const personCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  /** 可选链接到链成员用户（"爸爸"就是注册用户，spec §2 user_id），供 M3 查询 */
  userId: z.string().uuid().optional(),
});
export type PersonCreateInput = z.infer<typeof personCreateInputSchema>;

/** 改名（PATCH /api/chains/:chainId/persons/:personId，spec §6）；撞名归一化 → 409 PERSON_NAME_CONFLICT（server 职责） */
export const personPatchInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
});
export type PersonPatchInput = z.infer<typeof personPatchInputSchema>;

// ---------- 响应类型（spec §6） ----------

/** moment 上下文中的 person 视图；source 取自 moment_persons 关联行（词典行本身无 source 概念） */
export interface PersonBrief {
  id: string;
  name: string;
  /** 链接的链成员用户；未链接为 null */
  userId: string | null;
  source: MomentPersonSource;
}

/**
 * moment 响应中的地点（spec §6）。三个值列可空（仅名字 / 仅坐标均为合法形态，§6 赋值表），
 * source 非空；place 整体为 null 表示无地点（三列 + source 同生同灭）。
 */
export interface MomentPlace {
  /** WGS-84 原值（spec §4：DB 落原值，GCJ-02 换算只在调高德时发生） */
  lat: number | null;
  lng: number | null;
  /** 展示名（逆地理回填或手动/AI 文本）；exif 坐标待回填时为 null */
  name: string | null;
  source: PlaceSource;
}

/** 链 person 词典条目（GET /api/chains/:chainId/persons，spec §6 字面：{id, name, userId}） */
export interface PersonResponse {
  id: string;
  name: string;
  userId: string | null;
}

export interface PersonListResponse {
  persons: PersonResponse[];
}
