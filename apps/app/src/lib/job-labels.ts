import type { ChainJobDto } from '@moment/dto';

export const JOBS_POLL_MS = 10_000;

export function jobTypeLabel(type: ChainJobDto['type']): string {
  if (type === 'moment.compress') return '压缩图';
  return '索引';
}

export function jobStatusLabel(status: ChainJobDto['status']): string {
  if (status === 'pending') return '处理中';
  if (status === 'failed') return '失败';
  return '完成';
}
