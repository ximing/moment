import type { ChainJobDto, ChainJobListResponse, ChainJobsQuery } from '@moment/dto';
import { and, desc, inArray } from 'drizzle-orm';
import { Service } from 'typedi';
import { db } from '../db/index.js';
import { outbox, type OutboxRow } from '../db/schema.js';
import { OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED } from '../outbox/types.js';
import { logger } from '../utils/logger.js';

const JOB_TYPES = [OUTBOX_MOMENT_COMPRESS, OUTBOX_MOMENT_EMBED] as const;

function asPayloadObject(raw: unknown): Record<string, unknown> | null {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function toDto(row: OutboxRow, payload: Record<string, unknown>, momentId: string): ChainJobDto | null {
  const type = row.type;
  if (type !== OUTBOX_MOMENT_COMPRESS && type !== OUTBOX_MOMENT_EMBED) return null;
  return {
    id: row.id,
    type,
    status: row.status,
    momentId,
    mediaId:
      type === OUTBOX_MOMENT_EMBED
        ? null
        : typeof payload.mediaId === 'string' && payload.mediaId.length > 0
          ? payload.mediaId
          : null,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
  };
}

@Service()
export class JobsService {
  async list(chainId: string, query: ChainJobsQuery): Promise<ChainJobListResponse> {
    const rows = await db
      .select()
      .from(outbox)
      .where(and(inArray(outbox.type, [...JOB_TYPES]), inArray(outbox.status, query.status)))
      .orderBy(desc(outbox.createdAt));

    const jobs: ChainJobDto[] = [];
    for (const row of rows) {
      const payload = asPayloadObject(row.payload);
      if (!payload || payload.chainId !== chainId) continue;
      const momentId = payload.momentId;
      if (typeof momentId !== 'string' || momentId.length === 0) {
        logger.warn('jobs: skip outbox row missing payload.momentId', { id: row.id, type: row.type });
        continue;
      }
      const dto = toDto(row, payload, momentId);
      if (!dto) continue;
      jobs.push(dto);
      if (jobs.length >= query.limit) break;
    }
    return { jobs };
  }
}
