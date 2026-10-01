import { beforeEach, describe, expect, it, vi } from 'vitest';
import { register, resolve } from '@rabjs/react';
import type { AgentThread, MomentResponse } from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { AgentDockService, agentDockText } from './agent-dock.service';

const api = vi.hoisted(() => ({
  createAgentThread: vi.fn(),
  listAgentThreads: vi.fn(),
  getAgentThread: vi.fn(),
  deleteAgentThread: vi.fn(),
  streamAgentTurn: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  client: api,
}));

register(AgentDockService);

function svc(): AgentDockService {
  return resolve(AgentDockService);
}

function thread(id = 't1'): AgentThread {
  return {
    id,
    title: '新的对话',
    generatingAt: null,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  };
}

function moment(id: string): MomentResponse {
  return { id } as MomentResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createAgentThread.mockResolvedValue({ thread: thread() });
  api.listAgentThreads.mockResolvedValue({ threads: [] });
  api.getAgentThread.mockResolvedValue({ thread: thread(), messages: [] });
  api.deleteAgentThread.mockResolvedValue(undefined);
  api.streamAgentTurn.mockResolvedValue(undefined);
  svc().emit('auth:changed', null, 'global');
});

describe('AgentDockService', () => {
  it('构造时不请求，打开面板才拉历史', async () => {
    expect(api.listAgentThreads).not.toHaveBeenCalled();
    expect(api.createAgentThread).not.toHaveBeenCalled();
    expect(api.streamAgentTurn).not.toHaveBeenCalled();
    const service = svc();
    await service.openPanel();
    expect(service.open).toBe(true);
    expect(api.listAgentThreads).toHaveBeenCalledTimes(1);
    expect(service.threads).toEqual([]);
  });

  it('打开面板时拉当前对话的消息', async () => {
    const service = svc();
    service.threadId = 't1';
    const messages = [
      {
        id: 'm-user',
        threadId: 't1',
        role: 'user' as const,
        content: '以前的问题',
        moments: [],
        createdAt: '2026-10-02T00:00:00.000Z',
      },
    ];
    api.listAgentThreads.mockResolvedValue({ threads: [thread()] });
    api.getAgentThread.mockResolvedValue({ thread: thread(), messages });
    await service.openPanel();
    expect(api.getAgentThread).toHaveBeenCalledWith('t1');
    expect(service.messages).toEqual(messages);
  });

  it('token 逐段累加到助手消息', async () => {
    api.streamAgentTurn.mockImplementation(async (_id, _input, opts) => {
      opts.onEvent({ event: 'token', data: { text: '甲' } });
      opts.onEvent({ event: 'token', data: { text: '乙' } });
    });
    const service = svc();
    await service.send('你好');
    expect(api.createAgentThread).toHaveBeenCalledTimes(1);
    expect(api.streamAgentTurn).toHaveBeenCalledTimes(1);
    expect(api.streamAgentTurn.mock.calls[0]![0]).toBe('t1');
    expect(api.streamAgentTurn.mock.calls[0]![1]).toEqual({ content: '你好' });
    const assistant = service.messages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toBe('甲乙');
    expect(service.streaming).toBe(false);
  });

  it('时刻卡片按 id 追加，重复的丢掉', async () => {
    const first = moment('m-1');
    const second = moment('m-2');
    api.streamAgentTurn.mockImplementation(async (_id, _input, opts) => {
      opts.onEvent({ event: 'moments', data: { moments: [first, first] } });
      opts.onEvent({ event: 'moments', data: { moments: [first, second] } });
    });
    const service = svc();
    await service.send('找找');
    const assistant = service.messages.find((message) => message.role === 'assistant');
    expect(assistant?.moments.map((item) => item.id)).toEqual(['m-1', 'm-2']);
  });

  it('503 把 unavailable 设上，并说明助手还没接上', async () => {
    api.streamAgentTurn.mockRejectedValue(new ApiError('AGENT_UNAVAILABLE', 503, 'AGENT_UNAVAILABLE'));
    const service = svc();
    service.draft = '你好';
    await service.send('你好');
    expect(service.unavailable).toBe(true);
    expect(agentDockText.unavailable).toBe('助手还没接上');
    expect(service.streaming).toBe(false);
    expect(service.messages).toEqual([]);
    expect(service.draft).toBe('你好');
  });

  it('409 的文案是这条对话正在回答', async () => {
    api.streamAgentTurn.mockRejectedValue(new ApiError('AGENT_THREAD_BUSY', 409, 'AGENT_THREAD_BUSY'));
    const service = svc();
    await service.send('再问');
    expect(service.error).toBe('这条对话正在回答');
    expect(service.unavailable).toBe(false);
    expect(service.streaming).toBe(false);
    expect(service.messages).toEqual([]);
  });

  it('navigate 写入 pendingNav，ack 之后才清掉', async () => {
    const momentId = '22222222-2222-4222-8222-222222222222';
    const seen: Array<string | null> = [];
    api.streamAgentTurn.mockImplementation(async (_id, _input, opts) => {
      opts.onEvent({ event: 'status', data: { phase: 'thinking' } });
      seen.push(svc().statusText);
      opts.onEvent({ event: 'status', data: { phase: 'tool', name: 'search_moments' } });
      seen.push(svc().statusText);
      opts.onEvent({ event: 'navigate', data: { target: 'moment', momentId } });
    });
    const service = svc();
    await service.send('打开它');
    expect(seen).toEqual(['正在想…', '正在检索…']);
    expect(service.pendingNav).toEqual({ target: 'moment', momentId });
    expect(service.streaming).toBe(false);
    service.ackNav();
    expect(service.pendingNav).toBeNull();
  });

  it('流的 promise 结束但没有 done 时也退出正在发送', async () => {
    let streamingDuring = false;
    api.streamAgentTurn.mockImplementation(async () => {
      streamingDuring = svc().streaming;
    });
    const service = svc();
    await service.send('你好');
    expect(streamingDuring).toBe(true);
    expect(service.streaming).toBe(false);
    expect(service.statusText).toBeNull();
  });

  it('正在回答时忽略再次发送', async () => {
    let release: () => void = () => undefined;
    api.streamAgentTurn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const service = svc();
    service.threadId = 't1';
    const first = service.send('第一句');
    await service.send('第二句');
    expect(api.streamAgentTurn).toHaveBeenCalledTimes(1);
    expect(api.streamAgentTurn.mock.calls[0]![1]).toEqual({ content: '第一句' });
    release();
    await first;
    expect(service.streaming).toBe(false);
  });

  it('停止会中止这一轮', async () => {
    let signal: AbortSignal | undefined;
    api.streamAgentTurn.mockImplementation((_id, _input, opts) => {
      signal = opts.signal;
      return new Promise<void>((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const service = svc();
    service.threadId = 't1';
    const pending = service.send('停');
    expect(service.streaming).toBe(true);
    service.stop();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(service.streaming).toBe(false);
    expect(service.error).toBeNull();
  });

  it('页面上下文随这一轮送出，空上下文不带 context', async () => {
    const chainId = '33333333-3333-4333-8333-333333333333';
    const service = svc();
    service.threadId = 't1';
    await service.send('链上呢', { chainId });
    expect(api.streamAgentTurn.mock.calls[0]![1]).toEqual({ content: '链上呢', context: { chainId } });
    await service.send('随便', {});
    expect(api.streamAgentTurn.mock.calls[1]![1]).toEqual({ content: '随便' });
  });

  it('发送会使进行中的线程加载失效，不盖掉这一轮', async () => {
    let releaseGet: (value: { thread: AgentThread; messages: [] }) => void = () => undefined;
    api.getAgentThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGet = resolve;
        }),
    );
    api.streamAgentTurn.mockImplementation(async (_id, _input, opts) => {
      opts.onEvent({ event: 'token', data: { text: '还在' } });
    });
    const service = svc();
    const pendingSelect = service.selectThread('old');
    await service.send('新问题');
    releaseGet({ thread: thread('old'), messages: [] });
    await pendingSelect;
    expect(service.messages.map((message) => message.content)).toEqual(['新问题', '还在']);
    expect(service.streaming).toBe(false);
  });

  it('重新打开面板时，晚到的消息列表不盖掉正在发送的一轮', async () => {
    let releaseList: (value: { threads: AgentThread[] }) => void = () => undefined;
    api.listAgentThreads.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseList = resolve;
        }),
    );
    api.streamAgentTurn.mockImplementation(async (_id, _input, opts) => {
      opts.onEvent({ event: 'token', data: { text: '留着' } });
    });
    const service = svc();
    service.threadId = 't1';
    const opening = service.openPanel();
    await service.send('问');
    releaseList({ threads: [thread()] });
    await opening;
    expect(service.messages.map((message) => message.content)).toEqual(['问', '留着']);
  });

  it('创建对话期间重新打开，晚到的空列表不会清掉刚答完的内容', async () => {
    let releaseCreate: (value: { thread: AgentThread }) => void = () => undefined;
    api.createAgentThread.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    let releaseStream: () => void = () => undefined;
    api.streamAgentTurn.mockImplementation(async (_id, _input, opts) => {
      opts.onEvent({ event: 'token', data: { text: '留下' } });
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
    });
    let releaseList: (value: { threads: AgentThread[] }) => void = () => undefined;
    api.listAgentThreads.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseList = resolve;
        }),
    );
    const service = svc();
    const sending = service.send('问');
    await vi.waitFor(() => expect(api.createAgentThread).toHaveBeenCalled());
    const opening = service.openPanel();
    releaseCreate({ thread: thread() });
    await vi.waitFor(() => expect(api.streamAgentTurn).toHaveBeenCalled());
    releaseStream();
    await sending;
    releaseList({ threads: [] });
    await opening;
    expect(service.threadId).toBe('t1');
    expect(service.messages.map((message) => message.content)).toEqual(['问', '留下']);
  });

  it('重新加载较旧的对话不会把它排到更新的对话前面', async () => {
    const older = { ...thread('old'), updatedAt: '2026-10-01T00:00:00.000Z' };
    const newer = { ...thread('new'), updatedAt: '2026-10-02T00:00:00.000Z' };
    api.getAgentThread.mockResolvedValue({ thread: older, messages: [] });
    const service = svc();
    service.threads = [newer, older];
    await service.selectThread('old');
    expect(service.threads.map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('登出清空内存并收起，不发请求', () => {
    const service = svc();
    service.open = true;
    service.threadId = 't1';
    service.threads = [thread()];
    service.draft = '草稿';
    service.unavailable = true;
    service.pendingNav = { target: 'chain', chainId: 'c-1' };
    service.messages = [
      {
        id: 'local-user',
        threadId: 't1',
        role: 'user',
        content: '在',
        moments: [],
        createdAt: '2026-10-02T00:00:00.000Z',
      },
    ];
    service.emit('auth:changed', { id: 'u' }, 'global');
    expect(service.open).toBe(true);
    service.emit('auth:changed', null, 'global');
    expect(service.open).toBe(false);
    expect(service.threadId).toBeNull();
    expect(service.threads).toEqual([]);
    expect(service.messages).toEqual([]);
    expect(service.draft).toBe('');
    expect(service.unavailable).toBe(false);
    expect(service.pendingNav).toBeNull();
    expect(api.listAgentThreads).not.toHaveBeenCalled();
    expect(api.deleteAgentThread).not.toHaveBeenCalled();
  });
});
