import { z } from 'zod';

// ---------- 状态词表（spec §2：status enum） ----------

export const RECAP_STATUSES = ['generating', 'ready', 'failed', 'degraded'] as const;
export type RecapStatus = (typeof RECAP_STATUSES)[number];
export const recapStatusSchema = z.enum(RECAP_STATUSES);

// ---------- period 校验（spec §2：char(7) YYYY-MM） ----------

/**
 * YYYY-MM 格式校验：月份 01–12，补零必须。
 * spec §2 period = char(7)，按 wall_date 归属月份。
 */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'INVALID_PERIOD');
export type Period = string;

// ---------- token 用量（spec §2 token_usage json） ----------

export interface RecapTokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ---------- RecapDto（spec §2 全列 + §6 API 响应） ----------

export interface RecapDto {
  id: string;
  chainId: string;
  period: Period;
  status: RecapStatus;
  /** Markdown 正文（spec §2 content text） */
  content: string;
  /**
   * 引用的 moment id 有序列表（客户端渲染「高光时刻」跳转，spec §2/§7）。
   * spec §4 写 `highlight_moment_ids: number[]`，但 moments.id 是 char(36) UUID，
   * 故类型为 string[]（spec 笔误的机械修正，非设计发明）。
   */
  highlights: string[];
  /** 实际使用的模型名（审计）；failed/degraded 时为 null */
  model: string | null;
  /** prompt 模板版本（重生成对比用） */
  promptVersion: number;
  /** token 用量（成本核算）；failed/degraded 时为 null */
  tokenUsage: RecapTokenUsage | null;
  /** failed 时的摘要；非 failed 为 null */
  error: string | null;
  /** 生成完成时间；generating/failed 时为 null */
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- API 响应（spec §6） ----------

/** 回顾列表（period 倒序，无分页——每链每月至多一条，spec §6） */
export interface RecapListResponse {
  recaps: RecapDto[];
}

/**
 * 分享页外发的精简快照（spec §6：分享页附最近一期 ready/degraded 回顾）。
 * 字段集与 RecapDto 一致（content/highlights/model/period 全需要），直接复用。
 */
export type PublicShareRecap = RecapDto;
