import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Timeline } from '@/timeline/timeline';
import { Icon } from '@/ui/Icon';
import { Button } from '@/ui/button/index';
import { Banner, DetailSkeleton } from '@/ui/feedback/index';
import { Textarea } from '@/ui/field/index';
import { AlertDialog } from '@/ui/modal/index';
import { MomentPageService } from './moment.service';

// 时刻详情（plan Task 11）：评论 CRUD 与既有 service mutation 不变；回复输入走
// Field 家族的 Textarea，删除自己的评论先经 AlertDialog 确认（quiet 入口 +
// danger 终确认），错误反馈走 Banner。评论行是文字流，不画卡片阴影（spec §6）。

// 具名导出是测试 seam：bindServices 的私有容器实例在渲染前无法播种，
// 测试在全局容器注册同名 Service 后直接渲染本组件（timeline-variants.test.tsx）。
export const MomentPageContent = observer(function MomentPageContent() {
  const { momentId = '' } = useParams();
  const service = useService(MomentPageService);
  const auth = useService(AuthService);
  // 待确认删除的评论 id：纯 UI 确认态，不进 service（service 语义不变）
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    service.hydrate(momentId);
  }, [service, momentId]);

  // 三态判定（防 hydrate effect 首帧闪错误态：effect 跑起来前 loading 为 false）：
  //   骨架 = 无 moment 且（加载中 或 既无错也未删）；横幅 = 无 moment 且（加载失败或已删）
  const loadErr = service.$model.loadMoment.error;
  if (!service.moment && (service.$model.loadMoment.loading || (!loadErr && !service.deleted))) {
    return (
      <div className="max-w-content">
        <DetailSkeleton />
      </div>
    );
  }
  if (!service.moment) {
    return (
      <div className="max-w-content">
        <Banner
          tone="error"
          action={
            loadErr && !service.$model.loadMoment.loading
              ? { label: '重试', onPress: () => void service.loadMoment() }
              : undefined
          }
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
      <Link to={`/chains/${moment.chainId}`} className="inline-flex items-center gap-1 text-meta text-muted hover:text-ink">
        <Icon icon={ArrowLeft} size={14} />
        回链
      </Link>
      <Timeline
        variant="single"
        moments={[moment]}
        isPending={false}
        isError={false}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={() => undefined}
        empty={null}
      />
      <section>
        <h2 className="mb-3 text-lg font-medium">评论</h2>
        <ul className="space-y-3">
          {service.comments.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-medium text-ink">{c.author.nickname}</span>
              <span className="ml-2 text-ink">{c.content}</span>
              {auth.user?.id === c.author.id && (
                <button
                  type="button"
                  className="ml-2 text-meta text-danger transition-colors duration-[var(--ease)] hover:text-ink focus-visible:outline-none focus-visible:ring-focus"
                  onClick={() => setConfirmDeleteId(c.id)}
                >
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>
        {service.hasMore && (
          <Button variant="quiet" className="mt-2" onClick={() => void service.loadMoreComments()}>
            更早的评论
          </Button>
        )}
        {service.$model.submitComment.error && (
          <div className="mt-3">
            <Banner tone="error">{humanError(service.$model.submitComment.error)}</Banner>
          </div>
        )}
        {service.$model.deleteComment.error && (
          <div className="mt-3">
            <Banner tone="error">{humanError(service.$model.deleteComment.error)}</Banner>
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-4 space-y-2">
          <Textarea
            aria-label="回复"
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

      <AlertDialog
        open={confirmDeleteId !== null}
        title="删除这条评论？"
        body="删除后家人就看不到这条回应了。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        busy={service.$model.deleteComment.loading}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id) void service.deleteComment(id).catch(() => undefined); // 错误读 $model.deleteComment.error
        }}
      />
    </div>
  );
});

export const MomentPage = bindServices(MomentPageContent, [MomentPageService]);
