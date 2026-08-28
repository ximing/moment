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
