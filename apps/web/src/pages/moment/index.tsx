import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Timeline } from '@/timeline/timeline';
import { ArrowLeft } from 'lucide-react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Textarea } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { MomentPageService } from './moment.service';

const MomentPageContent = observer(function MomentPageContent() {
  const { momentId = '' } = useParams();
  const service = useService(MomentPageService);
  const auth = useService(AuthService);

  useEffect(() => {
    service.hydrate(momentId);
  }, [service, momentId]);

  // 三态判定（防 hydrate effect 首帧闪错误态：effect 跑起来前 loading 为 false）：
  //   骨架 = 无 moment 且（加载中 或 既无错也未删）；横幅 = 无 moment 且（加载失败或已删）
  const loadErr = service.$model.loadMoment.error;
  if (!service.moment && (service.$model.loadMoment.loading || (!loadErr && !service.deleted))) {
    // 骨架 60% surface：var() 色值的 /60 修饰静默不生成，用 color-mix（硬约束）
    return <div className="max-w-content h-40 animate-pulse rounded-card bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]" />;
  }
  if (!service.moment) {
    return (
      <div className="max-w-content">
        <Banner
          action={loadErr && !service.$model.loadMoment.loading ? { label: '重试', onClick: () => void service.loadMoment() } : undefined}
        >
          看不到这条时刻
        </Banner>
      </div>
    );
  }
  const moment = service.moment;

  function onSubmit(e: import('react').FormEvent) {
    e.preventDefault();
    if (!service.draft.trim()) return;
    void service.submitComment().catch(() => undefined); // 错误读 $model.submitComment.error
  }

  return (
    <div className="max-w-content space-y-6">
      <Link to={`/chains/${moment.chainId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        回链
      </Link>
      <Timeline
        moments={[moment]}
        isPending={false}
        isError={false}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => undefined}
        empty={null}
      />
      <section>
        {/* 「评论」不在得意黑字形子集内，不用 font-display */}
        <h2 className="mb-3 text-lg font-medium">评论</h2>
        <ul className="space-y-3">
          {service.comments.map((c) => (
            <li key={c.id} className="rounded-card border border-line bg-surface p-3 text-sm shadow-sticker">
              <span className="font-medium">{c.author.nickname}</span>
              <span className="ml-2">{c.content}</span>
              {auth.user?.id === c.author.id && (
                <button type="button" className="ml-2 text-xs text-danger" onClick={() => void service.deleteComment(c.id)}>
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>
        {service.hasMore && (
          <button type="button" className="mt-2 text-sm text-muted" onClick={() => void service.loadMoreComments()}>
            更早的评论
          </button>
        )}
        {service.$model.submitComment.error && (
          <div className="mt-3">
            <Banner>{humanError(service.$model.submitComment.error)}</Banner>
          </div>
        )}
        {service.$model.deleteComment.error && (
          <div className="mt-3">
            <Banner>{humanError(service.$model.deleteComment.error)}</Banner>
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-4 space-y-2">
          <Textarea
            value={service.draft}
            onChange={(e) => (service.draft = e.target.value)}
            placeholder="写一句…"
            rows={3}
          />
          <Button type="submit" disabled={service.$model.submitComment.loading || !service.draft.trim()}>
            发送
          </Button>
        </form>
      </section>
    </div>
  );
});

export const MomentPage = bindServices(MomentPageContent, [MomentPageService]);
