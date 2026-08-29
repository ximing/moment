import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RSRoot, register, resolve } from '@rabjs/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDto } from '@moment/dto';
import { AuthService } from '@/services/auth.service';
import { ChainSettingsService } from './chain-settings.service';
import { ChainSettingsSections } from './sections';
import { JOBS_POLL_MS, JobsSection, jobStatusLabel, jobTypeLabel } from './jobs-section';

const api = vi.hoisted(() => ({
  listChainJobs: vi.fn(),
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

beforeEach(() => {
  api.listChainJobs.mockReset().mockResolvedValue({ jobs: [] });
  api.listMembers.mockResolvedValue([]);
  api.listInvites.mockResolvedValue([]);
  api.listShareLinks.mockResolvedValue({ items: [] });
  api.listTags.mockResolvedValue({ tags: [] });
  const s = resolve(ChainSettingsService);
  s.chainId = 'chain-1';
  s.jobs = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('job labels', () => {
  it('类型与状态文案锁定 spec §7.4', () => {
    expect(jobTypeLabel('moment.compress')).toBe('压缩图');
    expect(jobTypeLabel('moment.embed')).toBe('索引');
    expect(jobStatusLabel('pending')).toBe('处理中');
    expect(jobStatusLabel('failed')).toBe('失败');
    expect(jobStatusLabel('done')).toBe('完成');
  });
});

function renderSections() {
  return render(
    <MemoryRouter>
      <RSRoot>
        <ChainSettingsSections />
      </RSRoot>
    </MemoryRouter>,
  );
}

describe('ChainSettingsSections jobs tab', () => {
  it('owner 可见「处理中」；editor 不可见', () => {
    const s = resolve(ChainSettingsService);
    s.chain = chain('owner');
    const { unmount } = renderSections();
    expect(screen.getByRole('button', { name: '处理中' })).toBeInTheDocument();
    unmount();
    s.chain = chain('editor');
    renderSections();
    expect(screen.queryByRole('button', { name: '处理中' })).toBeNull();
  });
});

describe('JobsSection', () => {
  it('空态「没有处理中的任务」；无重试按钮', async () => {
    api.listChainJobs.mockResolvedValue({ jobs: [] });
    await act(async () => {
      render(
        <RSRoot>
          <JobsSection />
        </RSRoot>,
      );
    });
    expect(await screen.findByText('没有处理中的任务')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试|再跑/ })).toBeNull();
  });

  it('列出类型、短 momentId、状态、次数、lastError', async () => {
    api.listChainJobs.mockResolvedValue({
      jobs: [
        {
          id: 'j-1',
          type: 'moment.compress',
          status: 'failed',
          momentId: '12345678-aaaa-bbbb-cccc-dddddddddddd',
          mediaId: 'm-1',
          attempts: 1,
          lastError: 'OBJECT_TOO_LARGE',
          createdAt: '2026-08-29T00:00:00.000Z',
          processedAt: null,
        },
      ],
    });
    await act(async () => {
      render(
        <RSRoot>
          <JobsSection />
        </RSRoot>,
      );
    });
    expect(await screen.findByText('压缩图')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('1 次')).toBeInTheDocument();
    expect(screen.getByText('OBJECT_TOO_LARGE')).toBeInTheDocument();
  });

  it(`可见时每 ${10000}ms 再 load 一次，unmount 停止`, async () => {
    vi.useFakeTimers();
    api.listChainJobs.mockResolvedValue({ jobs: [] });
    const { unmount } = render(
      <RSRoot>
        <JobsSection />
      </RSRoot>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.listChainJobs).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(JOBS_POLL_MS);
      await Promise.resolve();
    });
    expect(api.listChainJobs).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(JOBS_POLL_MS);
      await Promise.resolve();
    });
    expect(api.listChainJobs).toHaveBeenCalledTimes(2);
  });
});
