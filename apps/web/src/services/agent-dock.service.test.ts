import { register, resolve } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import type { AgentMessage, AgentNavigate, AgentSseEvent, AgentThread, MomentResponse } from '@moment/dto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { AgentDockService } from './agent-dock.service';

const api = vi.hoisted(() => ({
  createAgentThread: vi.fn(),
  listAgentThreads: vi.fn(),
  getAgentThread: vi.fn(),
  deleteAgentThread: vi.fn(),
  streamAgentTurn: vi.fn(),
  me: vi.fn(),
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
register(AgentDockService);

const STORAGE_KEY = 'moment.agent.dock';
const CHAIN_ID = '22222222-2222-4222-8222-222222222222';

function moment(id: string): MomentResponse {
  return {
    id,
    chainId: CHAIN_ID,
    author: { id: 'user-1', nickname: '林晓满', avatarUrl: null },
    type: 'text',
    content: `${id} 的正文`,
    transcript: null,
    transcriptionStatus: null,
    kind: 'standard',
    payload: null,
    happenedAt: '2026-03-01T02:00:00.000Z',
    happenedTzOffset: -480,
    isBackfill: false,
    createdAt: '2026-03-01T02:00:00.000Z',
    media: [],
    tags: [],
    persons: [],
    place: null,
    commentCount: 0,
    reactions: [],
    myReaction: null,
  };
}

function thread(patch: Partial<AgentThread> = {}): AgentThread {
  return {
    id: 'thread-1',
    title: '新的对话',
    generatingAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...patch,
  };
}

function assistant(content: string, moments: MomentResponse[]): AgentMessage {
  return {
    id: 'assistant-1',
    threadId: 'thread-1',
    role: 'assistant',
    content,
    moments,
    createdAt: '2026-03-01T00:01:00.000Z',
  };
}

type StreamOptions = {
  signal?: AbortSignal;
  onEvent: (event: AgentSseEvent) => void;
};

let service: AgentDockService;

/** Node 把全局 localStorage 留成 undefined 时，jsdom 的 window.localStorage 也会空。测持久化需要一块内存实现。 */
function ensureStorage(): Storage {
  const existing = window.localStorage;
  if (existing && typeof existing.getItem === 'function') return existing;
  const memory = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return memory.size;
    },
    clear() {
      memory.clear();
    },
    getItem(key) {
      return memory.get(key) ?? null;
    },
    key(index) {
      return [...memory.keys()][index] ?? null;
    },
    removeItem(key) {
      memory.delete(key);
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  return storage;
}

beforeEach(() => {
  api.createAgentThread.mockReset();
  api.listAgentThreads.mockReset();
  api.getAgentThread.mockReset();
  api.deleteAgentThread.mockReset();
  api.streamAgentTurn.mockReset();
  api.me.mockReset();
  api.listAgentThreads.mockResolvedValue({ threads: [] });
  api.getAgentThread.mockResolvedValue({ thread: thread(), messages: [] });
  api.createAgentThread.mockResolvedValue({ thread: thread() });
  api.deleteAgentThread.mockResolvedValue(undefined);
  api.streamAgentTurn.mockResolvedValue(undefined);
  ensureStorage().removeItem(STORAGE_KEY);
  service = resolve(AgentDockService);
  resolve(AuthService).emit('auth:changed', null, 'global');
});

describe('AgentDockService', () => {
  it('token 累加、时刻按 id 追加、写入 pendingNav，done 替换气泡并更新标题', async () => {
    const first = moment('moment-1');
    const second = moment('moment-2');
    let text = '';
    let ids: string[] = [];
    let nav: AgentNavigate | null = null;
    let status = '';
    api.streamAgentTurn.mockImplementation((_threadId: string, _input: unknown, options: StreamOptions) => {
      options.onEvent({ event: 'status', data: { phase: 'thinking' } });
      options.onEvent({ event: 'token', data: { text: '你' } });
      options.onEvent({ event: 'token', data: { text: '好' } });
      text = service.liveContent;
      options.onEvent({ event: 'status', data: { phase: 'tool', name: 'search_moments' } });
      status = service.statusText ?? '';
      options.onEvent({ event: 'moments', data: { moments: [first] } });
      options.onEvent({ event: 'moments', data: { moments: [first, second] } });
      ids = service.liveMoments.map((item) => item.id);
      options.onEvent({ event: 'navigate', data: { target: 'moment', momentId: first.id } });
      nav = service.pendingNav;
      options.onEvent({
        event: 'done',
        data: {
          message: assistant('最终', [first, second]),
          thread: thread({ title: '你好', updatedAt: '2026-03-02T00:00:00.000Z' }),
        },
      });
      return Promise.resolve();
    });

    service.threadId = 'thread-1';
    await service.send('问');

    expect(text).toBe('你好');
    expect(status).toBe('正在检索…');
    expect(ids).toEqual(['moment-1', 'moment-2']);
    expect(nav).toEqual({ target: 'moment', momentId: 'moment-1' });
    expect(service.pendingNav).toEqual({ target: 'moment', momentId: 'moment-1' });
    expect(service.streaming).toBe(false);
    expect(service.liveContent).toBe('');
    expect(service.messages.map((item) => item.content)).toEqual(['问', '最终']);
    expect(service.messages[1]?.moments.map((item) => item.id)).toEqual(['moment-1', 'moment-2']);
    expect(service.threads[0]?.title).toBe('你好');
    service.ackNav();
    expect(service.pendingNav).toBeNull();
  });

  it('把页面上下文原样交给 streamAgentTurn', async () => {
    service.threadId = 'thread-1';
    await service.send('问', { chainId: CHAIN_ID });

    expect(api.streamAgentTurn).toHaveBeenCalledWith(
      'thread-1',
      { content: '问', context: { chainId: CHAIN_ID } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('503 把 unavailable 设为 true，并退出 streaming', async () => {
    service.threadId = 'thread-1';
    api.streamAgentTurn.mockRejectedValue(new ApiError('down', 503, 'AGENT_UNAVAILABLE'));

    await service.send('问');

    expect(service.unavailable).toBe(true);
    expect(service.streaming).toBe(false);
    expect(service.error).toBeNull();
    expect(service.messages).toEqual([]);
  });

  it('409 的文案是这条对话正在回答', async () => {
    service.threadId = 'thread-1';
    api.streamAgentTurn.mockRejectedValue(new ApiError('busy', 409, 'AGENT_THREAD_BUSY'));

    await service.send('问');

    expect(service.error).toBe('这条对话正在回答');
    expect(service.streaming).toBe(false);
    expect(service.unavailable).toBe(false);
    expect(service.messages).toEqual([]);
  });

  it('AGENT_UPSTREAM 先记下失败，body 结束才退出 streaming', async () => {
    service.threadId = 'thread-1';
    let streamingAtError = false;
    api.streamAgentTurn.mockImplementation((_threadId: string, _input: unknown, options: StreamOptions) => {
      options.onEvent({ event: 'error', data: { code: 'AGENT_UPSTREAM' } });
      streamingAtError = service.streaming;
      return Promise.resolve();
    });

    await service.send('问');

    expect(streamingAtError).toBe(true);
    expect(service.error).toBe('这次没能答完，可以再说一次。');
    expect(service.streaming).toBe(false);
  });

  it('body 结束但没有 done 时退出 streaming', async () => {
    service.threadId = 'thread-1';
    api.streamAgentTurn.mockImplementation((_threadId: string, _input: unknown, options: StreamOptions) => {
      options.onEvent({ event: 'token', data: { text: '半截' } });
      return Promise.resolve();
    });

    await service.send('问');

    expect(service.streaming).toBe(false);
    expect(service.liveContent).toBe('');
    expect(service.messages.map((item) => item.content)).toEqual(['问', '半截']);
  });

  it('发送期间忽略再次发送，停止会 abort', async () => {
    service.streaming = true;
    await service.send('第二条');
    expect(api.streamAgentTurn).not.toHaveBeenCalled();

    service.streaming = false;
    service.threadId = 'thread-1';
    let signal: AbortSignal | undefined;
    api.streamAgentTurn.mockImplementation((_threadId: string, _input: unknown, options: StreamOptions) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (options.signal?.aborted) {
          abort();
          return;
        }
        options.signal?.addEventListener('abort', abort);
      });
    });

    const pending = service.send('问');
    expect(service.streaming).toBe(true);
    service.stop();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(service.streaming).toBe(false);
  });

  it('auth:changed 用户为空时清空内存、收起并删除 localStorage', () => {
    service.open = true;
    service.threadId = 'thread-1';
    service.messages = [assistant('留下的', [])];
    service.draft = '草稿';
    service.unavailable = true;
    service.error = '这条对话正在回答';
    service.pendingNav = { target: 'chain', chainId: CHAIN_ID };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ open: true, threadId: 'thread-1', messages: ['不该存'] }));

    resolve(AuthService).emit('auth:changed', null, 'global');

    expect(service.open).toBe(false);
    expect(service.threadId).toBeNull();
    expect(service.messages).toEqual([]);
    expect(service.draft).toBe('');
    expect(service.unavailable).toBe(false);
    expect(service.error).toBeNull();
    expect(service.pendingNav).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('只把 open 和 threadId 写入 moment.agent.dock', () => {
    service.threadId = 'thread-1';
    service.messages = [assistant('不落盘', [])];
    service.toggle();

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['open', 'threadId']);
    expect(parsed).toEqual({ open: true, threadId: 'thread-1' });
  });
});
