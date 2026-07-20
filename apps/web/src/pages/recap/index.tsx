import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { bindServices, observer, useService } from '@rabjs/react';
import { ArrowLeft } from 'lucide-react';
import { MarkdownText } from './markdown-text';
import { RecapPageService } from './recap-page.service';
import { Button } from '@/ui/button/index';
import { Banner, TimelineSkeleton } from '@/ui/feedback/index';

// recap 详情页（spec §7）：Markdown 正文 + 高光时刻区（highlights 引用的 moments 卡片，点击跳转详情）。
// 三态：骨架（加载中）/ 错误 Banner（重试）/ 内容。

export const RecapPageContent = observer(function RecapPageContent() {
  const { chainId = '', period = '' } = useParams();
  const navigate = useNavigate();
  const service = useService(RecapPageService);

  useEffect(() => {
    service.hydrate(chainId, period);
  }, [service, chainId, period]);

  const recap = service.recap;
  const loading = service.$model.load.loading;
  const error = service.$model.load.error;

  if (!recap && (loading || !error)) {
    return (
      <div>
        <BackButton onClick={() => navigate(`/chains/${chainId}`)} />
        <TimelineSkeleton />
      </div>
    );
  }
  if (!recap) {
    return (
      <div>
        <BackButton onClick={() => navigate(`/chains/${chainId}`)} />
        <Banner tone="error" action={error && !loading ? { label: '重试', onPress: () => service.load() } : undefined}>
          回顾加载失败，稍后再试试
        </Banner>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <BackButton onClick={() => navigate(`/chains/${chainId}`)} />
        <h1 className="text-page-title font-semibold text-ink">
          {Number(period.slice(5))} 月回顾
          {recap.status === 'degraded' && <span className="ml-2 text-meta font-normal text-muted">（简版）</span>}
        </h1>
      </header>

      <section className="mb-8">
        <MarkdownText content={recap.content} />
      </section>

      {service.highlights.length > 0 && (
        <section aria-label="高光时刻" className="mb-8">
          <h2 className="mb-4 text-body font-semibold text-ink">高光时刻</h2>
          <div className="flex flex-col gap-4">
            {service.highlights.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => navigate(`/moments/${m.id}`)}
                className="flex flex-col gap-1 rounded-surface-lg bg-surface px-4 py-3 text-left transition-colors duration-[var(--ease)] hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg"
              >
                {m.content && <span className="text-body text-ink line-clamp-3">{m.content}</span>}
                <span className="text-meta text-muted">{new Date(m.happenedAt).toLocaleDateString('zh-CN')}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
});

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" leadingIcon={ArrowLeft} onClick={onClick}>
      返回
    </Button>
  );
}

export const RecapPage = bindServices(RecapPageContent, [RecapPageService]);
