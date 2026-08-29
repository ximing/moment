import { z } from 'zod';

/**
 * GET /api/chains/:chainId/jobs 响应（spec §6.4）。路由/handler 属 P7。
 * type 仅投影 moment.compress / moment.embed；mediaId：compress 取 payload.mediaId，embed 恒 null。
 */
export interface ChainJobDto {
  id: string;
  type: 'moment.compress' | 'moment.embed';
  status: 'pending' | 'done' | 'failed';
  momentId: string;
  mediaId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface ChainJobListResponse {
  jobs: ChainJobDto[];
}

/** spec §6.4：缺省与上限都是 50；超过 50 条 v1 截断。 */
export const CHAIN_JOBS_DEFAULT_LIMIT = 50;
export const CHAIN_JOBS_MAX_LIMIT = 50;

const JOB_STATUS = z.enum(['pending', 'failed', 'done']);

/**
 * GET /api/chains/:chainId/jobs query（spec §6.4）。
 * status 可选 csv，默认 pending,failed；limit 1..50 默认 50。
 * 无 cursor。未知键 strip。api-client listChainJobs 属 P8，query 形状供其逐字抄。
 */
export const chainJobsQuerySchema = z
  .object({
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(CHAIN_JOBS_MAX_LIMIT).optional(),
  })
  .superRefine((val, ctx) => {
    const raw = val.status === undefined ? 'pending,failed' : val.status;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['status'] });
      return;
    }
    for (const p of parts) {
      if (!JOB_STATUS.safeParse(p).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'VALIDATION_ERROR', path: ['status'] });
        return;
      }
    }
  })
  .transform((val) => {
    const raw = val.status === undefined ? 'pending,failed' : val.status;
    const status: Array<'pending' | 'failed' | 'done'> = [];
    for (const p of raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
      if (p === 'pending' || p === 'failed' || p === 'done') {
        if (!status.includes(p)) status.push(p);
      }
    }
    return { status, limit: val.limit ?? CHAIN_JOBS_DEFAULT_LIMIT };
  });
export type ChainJobsQuery = z.infer<typeof chainJobsQuerySchema>;
