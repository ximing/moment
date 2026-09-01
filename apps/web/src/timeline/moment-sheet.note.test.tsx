import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RSRoot, register } from '@rabjs/react';
import type { MomentMedia } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { MomentSheetContent, type MomentSheetMoment } from './moment-sheet';
import { MomentSheetService } from './moment-sheet.service';

// 便利贴纸面契约（spec sticky-note-album §3）：
// Tag 与正文同一 text-meta 段、人物超过 3 个省略、有图地点叠面子、
// commentCount=0 不占回应入口、网格不渲染表情、article data-span 来自 noteColSpan。

vi.mock('@/api/client', () => ({
  client: new Proxy({}, { get: () => () => new Promise(() => undefined) }),
  tokenStore: {
    getAccessToken: () => null,
    getRefreshToken: () => Promise.resolve(null),
    setTokens: () => undefined,
    clear: () => undefined,
  },
  cachedUser: () => null,
  cacheUser: () => undefined,
}));

register(AuthService);
register(ComposeSessionService);
register(MomentSheetService);

function person(id: string, name: string, source: 'manual' | 'ai' = 'manual') {
  return { id, name, userId: null as string | null, source };
}

function img(id = 'img-1'): MomentMedia {
  return {
    id,
    url: `/api/media/${id}`,
    mime: 'image/jpeg',
    width: 100,
    height: 100,
    duration: null,
    sortOrder: 0,
    posterMediaId: null,
    posterUrl: null,
    derivedUrl: null,
    posterDerivedUrl: null,
  };
}

function moment(over: Partial<MomentSheetMoment> = {}): MomentSheetMoment {
  return {
    id: 'm-1',
    chainId: 'chain-1',
    author: { id: 'u-2', nickname: '妈妈', avatarUrl: null },
    type: 'text',
    content: '粥洒了一圈',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-08-20T10:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-08-20T10:00:00.000Z',
    media: [],
    tags: [],
    commentCount: 0,
    reactions: [],
    myReaction: null,
    ...over,
  };
}

function renderSheet(m: MomentSheetMoment, props: { readOnly?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <RSRoot>
        <MomentSheetContent moment={m} readOnly={props.readOnly} />
      </RSRoot>
    </MemoryRouter>,
  );
}

describe('moment-sheet 便利贴纸面', () => {
  it('Tag 与正文同一段 text-meta', () => {
    renderSheet(moment({ tags: [{ id: 't1', name: '早餐' }], content: '粥洒了一圈' }));
    expect(screen.getByText('#早餐').closest('p')).toHaveTextContent('#早餐粥洒了一圈');
  });

  it('超过 3 个人物截成三人加省略号', () => {
    renderSheet(
      moment({
        persons: [person('p1', '朵朵'), person('p2', '妈妈'), person('p3', '爸爸'), person('p4', '奶奶')],
      }),
    );
    expect(screen.getByLabelText('和谁在一起')).toHaveTextContent('朵朵 · 妈妈 · 爸爸…');
  });

  it('有图时地点叠在面子上、纸边 meta 不再重复 📍', () => {
    renderSheet(
      moment({
        type: 'media',
        media: [img()],
        place: { lat: 1, lng: 1, name: '厨房', source: 'manual' },
      }),
    );
    expect(screen.getByText('📍 厨房').closest('.note-face')).not.toBeNull();
    expect(screen.getAllByText('📍 厨房')).toHaveLength(1);
  });

  it('commentCount=0 不显示回应；>0 显示「N 回应」且是链到 /moments/:id 的链接', () => {
    const { unmount } = renderSheet(moment({ commentCount: 0 }));
    expect(screen.queryByText(/回应/)).toBeNull();
    unmount();
    renderSheet(moment({ commentCount: 2 }));
    expect(screen.getByRole('link', { name: /2 回应/ })).toHaveAttribute('href', '/moments/m-1');
  });

  it('readOnly 不渲染表情入口', () => {
    renderSheet(moment(), { readOnly: true });
    expect(screen.queryByRole('button', { name: '加个表情' })).toBeNull();
  });

  it('data-span 来自 noteColSpan', () => {
    renderSheet(moment());
    expect(screen.getByRole('article')).toHaveAttribute('data-span', '1');
  });
});
