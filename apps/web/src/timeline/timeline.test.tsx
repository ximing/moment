import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RSRoot, register } from '@rabjs/react';
import type { PublicShareMoment } from '@moment/dto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ComposeSessionService } from '@/services/compose-session.service';
import { Timeline } from './timeline';

register(ComposeSessionService);

vi.mock('./moment-sheet', () => ({
  MomentSheet({ moment }: { moment: PublicShareMoment }) {
    return <article>{moment.content}</article>;
  },
}));

const MOMENT: PublicShareMoment = {
  id: 'm-1',
  chainId: 'c-1',
  author: { id: 'u-1', nickname: '林晓满', avatarUrl: null },
  type: 'text',
  kind: 'standard',
  payload: null,
  content: '已有内容',
  transcript: null,
  transcriptionStatus: null,
  happenedAt: '2026-08-29T02:00:00.000Z',
  happenedTzOffset: -480,
  isBackfill: false,
  createdAt: '2026-08-29T02:00:00.000Z',
  media: [],
  tags: [],
  commentCount: 0,
  reactions: [],
  myReaction: null,
};

beforeAll(() => {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

function renderTimeline(props: Partial<Parameters<typeof Timeline>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RSRoot>
        <Timeline
          moments={[]}
          isPending={false}
          isError={false}
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={() => undefined}
          empty={<p>空时间线</p>}
          {...props}
        />
      </RSRoot>
    </MemoryRouter>,
  );
}

describe('Timeline 刷新时保留已有列表', () => {
  it('首屏 pending 且无数据时相册骨架 8 张纸', () => {
    const { container } = renderTimeline({ isPending: true, moments: [] });
    expect(container.querySelectorAll('[data-skeleton-note]').length).toBe(8);
  });

  it('已有时刻时 pending 不换成骨架，文章仍在', () => {
    renderTimeline({ isPending: true, moments: [MOMENT] });
    expect(screen.getByRole('article')).toHaveTextContent('已有内容');
  });

  it('已有时刻时 error 不换成整页横幅', () => {
    renderTimeline({ isError: true, moments: [MOMENT] });
    expect(screen.getByRole('article')).toHaveTextContent('已有内容');
    expect(screen.queryByText('没法刷新，点重试')).toBeNull();
  });
});

describe('Timeline 按月相册网格', () => {
  it('按月渲染 region，不出现「今天」日期结和日子线', () => {
    renderTimeline({ moments: [MOMENT] });
    expect(screen.getByRole('region', { name: '2026 · 8 月' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '今天' })).toBeNull();
    expect(document.querySelector('.border-dashed')).toBeNull();
  });

  it('variant=single 不渲染月头', () => {
    renderTimeline({ moments: [MOMENT], variant: 'single' });
    expect(screen.queryByRole('region', { name: '2026 · 8 月' })).toBeNull();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });
});
