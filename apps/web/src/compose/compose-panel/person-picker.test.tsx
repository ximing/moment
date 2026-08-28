import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { register, resolve } from '@rabjs/react';
import type { ChainDto, ChainMemberDto } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/services/auth.service';
import { ChainListService } from '@/services/chain-list.service';
import { ComposeSessionService } from '@/services/compose-session.service';
import { ComposePanelService } from './compose-panel.service';
import { PersonPicker } from './person-picker';

// 人物选择器 + 地点输入契约（spec people-place §7）：
// - 链成员置顶 chip：选中即幂等 POST {name, userId}（词典已有该用户则直接选，不 POST）；
// - 词典 chip 多选（aria-pressed），选中的 ai 来源行带「AI」角标；
// - 自由文本回车 → 幂等 POST {name} 并选中；
// - 地点 TextField + EXIF chip（「已从照片读取位置」，点 × 移除）。
// jsdom 下 RAB 属性变更不触发 observer 重渲（chain-home.test.tsx 同一约定）：
// 初始 DOM 断言靠渲染前播种，交互断言以 service 状态 + api 调用参数为准。

const api = vi.hoisted(() => ({
  listPersons: vi.fn(),
  listMembers: vi.fn(),
  createPerson: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  client: api,
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
register(ChainListService);
register(ComposeSessionService);
register(ComposePanelService);

function chain(id: string): ChainDto {
  return {
    id,
    name: `链${id}`,
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: null,
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
    myRole: 'owner',
  };
}

const MEMBER: ChainMemberDto = {
  userId: 'u-1',
  nickname: '林晓满',
  avatarUrl: null,
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
};

/** 单例复位 + 播种（不走 hydrate，直接写字段）。 */
function seed(): ComposePanelService {
  const s = resolve(ComposePanelService);
  s.request = null;
  s.pickedChainId = 'chain-1';
  s.personList = [];
  s.members = [];
  s.selectedPersons = [];
  s.personQuery = '';
  s.personsTouched = false;
  s.placeName = '';
  s.placeCoords = null;
  s.placeTouched = false;
  s.exifDismissed = false;
  s.error = null;
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolve(ChainListService).chains = [chain('chain-1')];
});

describe('PersonPicker（spec people-place §7）', () => {
  it('链成员置顶 + 词典 chip 多选（aria-pressed）+ AI 角标 + 地点输入框', () => {
    const s = seed();
    s.members = [MEMBER];
    s.personList = [{ id: 'p-1', name: '外婆', userId: null }];
    s.selectedPersons = [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }];
    render(<PersonPicker service={s} />);
    expect(screen.getByText('林晓满')).toBeInTheDocument(); // 链成员置顶
    const chip = screen.getByRole('button', { name: /外婆/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AI')).toBeInTheDocument(); // ai 来源角标（spec §7 轻标识）
    expect(screen.getByLabelText('在哪里')).toBeInTheDocument();
  });

  it('已选但词典未加载的行（如编辑模式 ai 人物）并入 chip 组：可见、带 AI 角标、可删（置顶）', () => {
    const s = seed();
    s.selectedPersons = [{ id: 'p-1', name: '外婆', userId: null, source: 'ai' }];
    render(<PersonPicker service={s} />);
    const chip = screen.getByRole('button', { name: /外婆/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AI')).toBeInTheDocument();
    fireEvent.click(chip);
    expect(s.selectedPersons).toEqual([]);
  });

  it('点链成员：词典无该用户 → 幂等 POST {name, userId} 并选中', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-2', name: '林晓满', userId: 'u-1' });
    const s = seed();
    s.members = [MEMBER];
    render(<PersonPicker service={s} />);
    fireEvent.click(screen.getByText('林晓满'));
    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '林晓满', userId: 'u-1' }));
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-2']);
    expect(s.personsTouched).toBe(true);
  });

  it('点链成员：词典已有该用户的 person → 直接选，不 POST', async () => {
    const s = seed();
    s.members = [MEMBER];
    s.personList = [{ id: 'p-1', name: '林晓满', userId: 'u-1' }];
    render(<PersonPicker service={s} />);
    fireEvent.click(screen.getByText('林晓满'));
    await waitFor(() => expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-1']));
    expect(api.createPerson).not.toHaveBeenCalled();
  });

  it('自由文本回车 → 幂等 POST {name} 并选中、清空输入（spec §6/§7）', async () => {
    api.createPerson.mockResolvedValue({ id: 'p-9', name: '王叔叔', userId: null });
    const s = seed();
    render(<PersonPicker service={s} />);
    const input = screen.getByLabelText('搜索或新建人物');
    fireEvent.change(input, { target: { value: '王叔叔' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '王叔叔' }));
    expect(s.selectedPersons.map((p) => p.id)).toEqual(['p-9']);
    expect(s.personQuery).toBe('');
  });

  it('词典输入即前端过滤（偏差 6：全量 GET + includes）', () => {
    const s = seed();
    s.personList = [
      { id: 'p-1', name: '外婆', userId: null },
      { id: 'p-2', name: '朵朵', userId: null },
    ];
    s.personQuery = '朵';
    render(<PersonPicker service={s} />);
    expect(screen.queryByText('外婆')).toBeNull();
    expect(screen.getByRole('button', { name: /朵朵/ })).toBeInTheDocument();
  });

  it('EXIF chip：「已从照片读取位置」+ 点 × 移除（placeTouched/exifDismissed 置位）', () => {
    const s = seed();
    s.placeCoords = { lat: 39.9042, lng: 116.4074 };
    render(<PersonPicker service={s} />);
    expect(screen.getByText('已从照片读取位置')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('移除照片位置'));
    expect(s.placeCoords).toBeNull();
    expect(s.placeTouched).toBe(true);
    expect(s.exifDismissed).toBe(true);
  });
});
