import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RSRoot, register } from '@rabjs/react';
import type { PublicShareMoment } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { MomentSheetContent } from './moment-sheet';
import { MomentSheetService } from './moment-sheet.service';

// 纸边人物/地点（spec sticky-note-album §3.3 / §3.4）：
// - 人物最多 3 名以「 · 」连接，无「AI」角标；
// - 无面子图时地点走纸边（MapPin 单色图标 + name）；exif name:null 不渲染；
// - 公开分享形态（无 persons/place 键）两者都不渲染；
// - 传入 onPersonFilter / onPlaceFilter 时人物/地点是 button。

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

function moment(partial: {
  persons?: { id: string; name: string; userId: string | null; source: 'manual' | 'ai' }[];
  place?: { lat: number | null; lng: number | null; name: string | null; source: 'manual' | 'exif' | 'ai' } | null;
}) {
  return {
    id: 'm-1',
    chainId: 'chain-1',
    author: { id: 'u-2', nickname: '妈妈', avatarUrl: null },
    type: 'text' as const,
    content: '在外婆家吃饭',
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard' as const,
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
    ...partial,
  };
}

function renderSheet(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <RSRoot>{ui}</RSRoot>
    </MemoryRouter>,
  );
}

describe('moment-sheet 人物/地点展示（spec people-place §7）', () => {
  it('纯文字 + 人物 + 地点：纸边「爸爸 · 外婆」，无 AI，地点图标在纸边（无面子图）', () => {
    renderSheet(
      <MomentSheetContent
        readOnly
        moment={moment({
          persons: [
            { id: 'p-1', name: '爸爸', userId: 'u-1', source: 'manual' },
            { id: 'p-2', name: '外婆', userId: null, source: 'ai' },
          ],
          place: { lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' },
        })}
      />,
    );
    const group = screen.getByLabelText('和谁在一起');
    expect(group).toHaveTextContent('爸爸 · 外婆');
    expect(screen.queryByText('AI')).toBeNull();
    const place = screen.getByText('外婆家');
    expect(place.closest('.note-face')).toBeNull();
    // spec 2026-09-03-svg-icon-system §4.4：📍 前缀是写死装饰字符，换 lucide MapPin
    expect(screen.queryByText(/📍/)).toBeNull();
    expect(place.querySelector('svg.lucide-map-pin')).not.toBeNull();
  });

  it('exif 坐标待回填（name:null）→ 不显示地点行（偏差 9）', () => {
    renderSheet(
      <MomentSheetContent readOnly moment={moment({ place: { lat: 39.9, lng: 116.4, name: null, source: 'exif' } })} />,
    );
    expect(screen.queryByText(/📍/)).toBeNull();
  });

  it('公开分享形态（无 persons/place 键）→ 两行均不渲染（spec §8 红线在展示层生效）', () => {
    const shared = Object.fromEntries(
      Object.entries(moment({})).filter(([k]) => k !== 'persons' && k !== 'place'),
    ) as unknown as PublicShareMoment;
    renderSheet(<MomentSheetContent readOnly moment={shared} />);
    expect(screen.queryByLabelText('和谁在一起')).toBeNull();
    expect(screen.queryByText(/📍/)).toBeNull();
  });

  it('传入 onPersonFilter/onPlaceFilter：人物/地点是 button，再点回调；无 AI 角标', async () => {
    const user = userEvent.setup();
    const onPersonFilter = vi.fn();
    const onPlaceFilter = vi.fn();
    renderSheet(
      <MomentSheetContent
        readOnly
        moment={moment({
          persons: [
            { id: 'p-1', name: '爸爸', userId: 'u-1', source: 'manual' },
            { id: 'p-2', name: '外婆', userId: null, source: 'ai' },
          ],
          place: { lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' },
        })}
        onPersonFilter={onPersonFilter}
        onPlaceFilter={onPlaceFilter}
      />,
    );
    const group = screen.getByLabelText('和谁在一起');
    expect(within(group).getByRole('button', { name: '筛选 外婆' })).toBeInTheDocument();
    expect(screen.queryByText('AI')).toBeNull();
    await user.click(within(group).getByRole('button', { name: '筛选 外婆' }));
    expect(onPersonFilter).toHaveBeenCalledWith({ id: 'p-2', name: '外婆' });
    await user.click(screen.getByRole('button', { name: '筛选地点 外婆家' }));
    expect(onPlaceFilter).toHaveBeenCalledWith('外婆家');
  });
});
