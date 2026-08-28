import { render, screen, within } from '@testing-library/react';
import { RSRoot, register } from '@rabjs/react';
import type { PublicShareMoment } from '@moment/dto';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { MomentSheetContent } from './moment-sheet';
import { MomentSheetService } from './moment-sheet.service';

// 人物 chip 行与地点行的只读展示（spec people-place §7/§8）：
// - 链内形态（MomentResponse）：persons chips（span 非按钮——不可点，过滤属 M2）+
//   ai 行「AI」角标 + 「📍 name」地点行；
// - exif 坐标待回填（name:null）不显示地点行（偏差 9）；
// - 公开分享形态（PublicShareMoment：两键不存在）两者都不渲染——隐私红线在展示层生效。

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

describe('moment-sheet 人物/地点展示（spec people-place §7）', () => {
  // RSRoot 包裹（timeline-variants/chain-home 既有范式）：useService 需要 RAB 容器上下文。
  // 三个用例均不传 chainName 且 readOnly（Link 渲染路径未触发），无需 MemoryRouter。
  it('链内形态：人物 chips（只读 span）+ AI 角标 + 地点行', () => {
    render(
      <RSRoot>
        <MomentSheetContent
          readOnly
          moment={moment({
            persons: [
              { id: 'p-1', name: '爸爸', userId: 'u-1', source: 'manual' },
              { id: 'p-2', name: '外婆', userId: null, source: 'ai' },
            ],
            place: { lat: 39.9, lng: 116.4, name: '外婆家', source: 'manual' },
          })}
        />
      </RSRoot>,
    );
    const group = screen.getByLabelText('和谁在一起');
    expect(within(group).getByText('爸爸')).toBeInTheDocument();
    expect(within(group).getByText('外婆')).toBeInTheDocument();
    expect(within(group).getByText('AI')).toBeInTheDocument();
    // 只读展示：chip 是 span 不是 button（spec §7：点击过滤属 M2，v1 不可点）
    expect(within(group).queryByRole('button')).toBeNull();
    expect(screen.getByText('📍 外婆家')).toBeInTheDocument();
  });

  it('exif 坐标待回填（name:null）→ 不显示地点行（偏差 9）', () => {
    render(
      <RSRoot>
        <MomentSheetContent readOnly moment={moment({ place: { lat: 39.9, lng: 116.4, name: null, source: 'exif' } })} />
      </RSRoot>,
    );
    expect(screen.queryByText(/📍/)).toBeNull();
  });

  it('公开分享形态（无 persons/place 键）→ 两行均不渲染（spec §8 红线在展示层生效）', () => {
    const shared = Object.fromEntries(
      Object.entries(moment({})).filter(([k]) => k !== 'persons' && k !== 'place'),
    ) as unknown as PublicShareMoment;
    render(
      <RSRoot>
        <MomentSheetContent readOnly moment={shared} />
      </RSRoot>,
    );
    expect(screen.queryByLabelText('和谁在一起')).toBeNull();
    expect(screen.queryByText(/📍/)).toBeNull();
  });
});
