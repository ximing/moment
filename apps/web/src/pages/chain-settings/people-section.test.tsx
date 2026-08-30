import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainSettingsService } from './chain-settings.service';
import { PeopleSection } from './people-section';
import { ChainSettingsSections } from './sections';

const api = vi.hoisted(() => ({
  listPersons: vi.fn(),
  createPerson: vi.fn(),
  renamePerson: vi.fn(),
  removePerson: vi.fn(),
  getChain: vi.fn(),
  listMembers: vi.fn(),
  listInvites: vi.fn(),
  listShareLinks: vi.fn(),
  listTags: vi.fn(),
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
register(ChainSettingsService);

function chain(role: ChainDto['myRole']): ChainDto {
  return {
    id: 'chain-1',
    name: '周末小家',
    description: null,
    avatarMediaId: null,
    avatarUrl: null,
    avatarFocus: null,
    coverMediaId: null,
    coverUrl: null,
    coverFocus: null,
    color: 'mint',
    icon: null,
    visibility: 'private',
    template: 'daily',
    payload: null,
    ownerId: 'user-1',
    myRole: role,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    membersPreview: [],
    memberCount: 1,
  };
}

function renderSections() {
  return render(
    <MemoryRouter>
      <RSRoot>
        <ChainSettingsSections />
      </RSRoot>
    </MemoryRouter>,
  );
}

function renderPeople() {
  return render(
    <RSRoot>
      <PeopleSection />
    </RSRoot>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listPersons.mockResolvedValue({ persons: [] });
  api.listMembers.mockResolvedValue([]);
  api.listInvites.mockResolvedValue([]);
  api.listShareLinks.mockResolvedValue({ items: [] });
  api.listTags.mockResolvedValue({ tags: [] });
  const s = resolve(ChainSettingsService);
  s.chainId = 'chain-1';
  s.chain = chain('owner');
  s.persons = [];
  s.newPersonName = '';
});

describe('ChainSettingsSections 人物 tab', () => {
  it('owner / editor 可见「人物」；viewer 不可见', () => {
    const s = resolve(ChainSettingsService);
    s.chain = chain('owner');
    const { unmount } = renderSections();
    expect(screen.getByRole('button', { name: '人物' })).toBeInTheDocument();
    unmount();

    s.chain = chain('editor');
    const second = renderSections();
    expect(screen.getByRole('button', { name: '人物' })).toBeInTheDocument();
    second.unmount();

    s.chain = chain('viewer');
    renderSections();
    expect(screen.queryByRole('button', { name: '人物' })).toBeNull();
  });
});

describe('PeopleSection', () => {
  it('空名单展示空态', () => {
    renderPeople();
    expect(screen.getByText('还没有人物')).toBeInTheDocument();
  });

  it('播种名字后点添加走 createPerson', async () => {
    const user = userEvent.setup();
    const s = resolve(ChainSettingsService);
    s.newPersonName = '外婆';
    api.createPerson.mockResolvedValue({ id: 'p-1', name: '外婆', userId: null });
    api.listPersons.mockResolvedValue({ persons: [{ id: 'p-1', name: '外婆', userId: null }] });
    renderPeople();

    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(api.createPerson).toHaveBeenCalledWith('chain-1', { name: '外婆' }));
  });

  it('失焦改名走 renamePerson', async () => {
    const s = resolve(ChainSettingsService);
    s.persons = [{ id: 'p-1', name: '外婆', userId: null }];
    api.renamePerson.mockResolvedValue({ id: 'p-1', name: '姥姥', userId: null });
    api.listPersons.mockResolvedValue({ persons: [{ id: 'p-1', name: '姥姥', userId: null }] });
    renderPeople();

    const input = screen.getByLabelText('人物 外婆');
    fireEvent.blur(input, { target: { value: '姥姥' } });

    await waitFor(() => expect(api.renamePerson).toHaveBeenCalledWith('chain-1', 'p-1', { name: '姥姥' }));
  });

  it('删除先确认再 removePerson', async () => {
    const user = userEvent.setup();
    const s = resolve(ChainSettingsService);
    s.persons = [{ id: 'p-1', name: '外婆', userId: null }];
    api.removePerson.mockResolvedValue(undefined);
    api.listPersons.mockResolvedValue({ persons: [] });
    renderPeople();

    await user.click(screen.getByRole('button', { name: '删除 外婆' }));
    expect(screen.getByText('去掉「外婆」？')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '去掉' }));

    await waitFor(() => expect(api.removePerson).toHaveBeenCalledWith('chain-1', 'p-1'));
  });
});
