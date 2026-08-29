import { describe, expect, it } from 'vitest';
import { JOBS_POLL_MS, jobStatusLabel, jobTypeLabel } from './job-labels';

describe('job labels（spec fused-retrieval §7.4）', () => {
  it('轮询间隔 10s', () => {
    expect(JOBS_POLL_MS).toBe(10_000);
  });

  it('类型与状态文案锁定', () => {
    expect(jobTypeLabel('moment.compress')).toBe('压缩图');
    expect(jobTypeLabel('moment.embed')).toBe('索引');
    expect(jobStatusLabel('pending')).toBe('处理中');
    expect(jobStatusLabel('failed')).toBe('失败');
    expect(jobStatusLabel('done')).toBe('完成');
  });
});
