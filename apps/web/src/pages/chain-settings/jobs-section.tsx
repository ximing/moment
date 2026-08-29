import { useEffect, useState } from 'react';
import type { ChainJobDto } from '@moment/dto';
import { observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { Banner, EmptyState } from '@/ui/feedback/index';
import { ChainSettingsService } from './chain-settings.service';

export const JOBS_POLL_MS = 10_000;

// eslint-disable-next-line react-refresh/only-export-components -- 文案函数与分区同文件，测试与列表共用
export function jobTypeLabel(type: ChainJobDto['type']): string {
  if (type === 'moment.compress') return '压缩图';
  return '索引';
}

// eslint-disable-next-line react-refresh/only-export-components -- 文案函数与分区同文件，测试与列表共用
export function jobStatusLabel(status: ChainJobDto['status']): string {
  if (status === 'pending') return '处理中';
  if (status === 'failed') return '失败';
  return '完成';
}

export const JobsSection = observer(function JobsSection() {
  const service = useService(ChainSettingsService);
  // jsdom 下 RAB 属性变更不重渲：loadJobs 落地后 bump 一次让列表读到新 jobs。
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () =>
      service
        .loadJobs()
        .then(() => setTick((n) => n + 1))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(() => {
      void load();
    }, JOBS_POLL_MS);
    return () => window.clearInterval(id);
  }, [service]);

  const error = service.$model.loadJobs.error;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">处理中</h2>
      <p className="text-meta text-muted">压缩图和检索索引的后台任务，只有创建者看得到。</p>
      {error ? <Banner tone="error">{humanError(error)}</Banner> : null}
      {service.jobs.length === 0 ? (
        <EmptyState variant="plain" scope="section" title="没有处理中的任务" description="发布新照片后，压缩和索引会排在这里。" />
      ) : (
        <ul className="flex flex-col gap-1">
          {service.jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-baseline gap-2 py-2 text-meta">
              <span className="text-ink">{jobTypeLabel(job.type)}</span>
              <span className="text-muted">{job.momentId.slice(0, 8)}</span>
              <span>{jobStatusLabel(job.status)}</span>
              <span className="text-muted">{job.attempts} 次</span>
              {job.lastError ? <span className="text-danger">{job.lastError}</span> : null}
              <span className="ml-auto text-muted">{new Date(job.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
