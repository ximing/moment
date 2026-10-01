import { Service } from '@rabjs/react';
import type {
  AgentMessage,
  AgentNavigate,
  AgentSseEvent,
  AgentThread,
  PostAgentTurnInput,
  UserProfile,
} from '@moment/dto';
import { ApiError } from '@moment/api-client';
import { client } from '../lib/api';
import { humanError } from '../lib/errors';

export const agentDockText = {
  unavailable: '助手还没接上',
  busy: '这条对话正在回答',
  thinking: '正在想…',
  searching: '正在检索…',
} as const;

const CONTENT_MAX = 2000;

export interface AgentTurnContext {
  chainId?: string;
  momentId?: string;
}

interface TurnRollback {
  base: number;
  committed: boolean;
  text: string;
  restoreDraft: boolean;
}

let localSeq = 0;

function localMessage(role: 'user' | 'assistant', threadId: string, content: string): AgentMessage {
  localSeq += 1;
  return {
    id: `local-${role}-${localSeq}`,
    threadId,
    role,
    content,
    moments: [],
    createdAt: new Date().toISOString(),
  };
}

function turnInput(content: string, context?: AgentTurnContext): PostAgentTurnInput {
  const chainId = context?.chainId;
  const momentId = context?.momentId;
  if (!chainId && !momentId) return { content };
  return {
    content,
    context: {
      ...(chainId ? { chainId } : {}),
      ...(momentId ? { momentId } : {}),
    },
  };
}

function isAbort(err: unknown, signal: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * 全局助手。不引用 expo-router：导航只写 pendingNav，由宿主跳转后 ackNav。
 * 历史在服务端；这里不把开关写进 SecureStore / AsyncStorage。
 */
export class AgentDockService extends Service {
  open = false;
  threadId: string | null = null;
  threads: AgentThread[] = [];
  messages: AgentMessage[] = [];
  draft = '';
  streaming = false;
  statusText: string | null = null;
  error: string | null = null;
  unavailable = false;
  pendingNav: AgentNavigate | null = null;

  private _epoch = 0;
  private _loadSeq = 0;
  private _turnAbort: AbortController | null = null;

  constructor() {
    super();
    // 构造时不打接口：未登录冷启动和单测都会创建这个单例。列表等面板打开再拉。
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (!user) this._clearMemory();
      },
      'global',
    );
  }

  async openPanel(): Promise<void> {
    this.open = true;
    const epoch = this._epoch;
    const seq = ++this._loadSeq;
    const threadAtStart = this.threadId;
    try {
      const { threads } = await client.listAgentThreads();
      if (!this._current(epoch, seq)) return;
      const createdDuringLoad = this.threadId !== null && this.threadId !== threadAtStart;
      if (createdDuringLoad && !threads.some((thread) => thread.id === this.threadId)) return;
      this.threads = threads;
      if (this.streaming || !this.threadId) return;
      if (!threads.some((thread) => thread.id === this.threadId)) {
        this.threadId = null;
        this.messages = [];
        return;
      }
      await this._loadSelected(this.threadId, epoch, seq);
    } catch (err) {
      if (!this._current(epoch, seq)) return;
      this.error = humanError(err);
    }
  }

  closePanel(): void {
    this.open = false;
  }

  newChat(): void {
    if (this.streaming) return;
    this._loadSeq += 1;
    this.threadId = null;
    this.messages = [];
    this.error = null;
    this.statusText = null;
  }

  async selectThread(id: string): Promise<void> {
    if (this.streaming) return;
    const epoch = this._epoch;
    const seq = ++this._loadSeq;
    this.threadId = id;
    this.messages = [];
    this.error = null;
    await this._loadSelected(id, epoch, seq);
  }

  async deleteThread(id: string): Promise<void> {
    if (this.streaming) return;
    const epoch = this._epoch;
    try {
      await client.deleteAgentThread(id);
      if (epoch !== this._epoch) return;
      this.threads = this.threads.filter((thread) => thread.id !== id);
      if (this.threadId === id) {
        this._loadSeq += 1;
        this.threadId = null;
        this.messages = [];
      }
    } catch (err) {
      if (epoch !== this._epoch) return;
      if (err instanceof ApiError && err.status === 409) {
        this.error = agentDockText.busy;
        return;
      }
      this.error = humanError(err);
    }
  }

  ackNav(): void {
    this.pendingNav = null;
  }

  stop(): void {
    this._turnAbort?.abort();
  }

  async send(content: string, context?: AgentTurnContext): Promise<void> {
    const text = content.trim();
    if (!text || this.streaming) return;
    if (text.length > CONTENT_MAX) {
      this.error = '有些内容需要改一改';
      return;
    }
    const epoch = this._epoch;
    // 进行中的 openPanel / selectThread 仍拿着旧序号。先作废，避免 GET 回来盖掉这一轮。
    this._loadSeq += 1;
    const rollback: TurnRollback = {
      base: this.messages.length,
      committed: false,
      text,
      restoreDraft: this.draft.trim() === text,
    };
    this.streaming = true;
    this.error = null;
    this.statusText = agentDockText.thinking;
    this._turnAbort = new AbortController();
    const signal = this._turnAbort.signal;
    if (rollback.restoreDraft) this.draft = '';
    let sawEvent = false;
    let calledStream = false;
    try {
      if (!this.threadId) {
        const created = await client.createAgentThread();
        if (epoch !== this._epoch || signal.aborted) return;
        this.threadId = created.thread.id;
        this._upsertThread(created.thread);
      }
      const threadId = this.threadId;
      if (!threadId || epoch !== this._epoch || signal.aborted) return;
      const assistant = localMessage('assistant', threadId, '');
      rollback.base = this.messages.length;
      this.messages = [...this.messages, localMessage('user', threadId, text), assistant];
      rollback.committed = true;
      const slot = { id: assistant.id };
      calledStream = true;
      await client.streamAgentTurn(threadId, turnInput(text, context), {
        signal,
        onEvent: (event) => {
          if (epoch !== this._epoch) return;
          sawEvent = true;
          this._applyEvent(event, slot);
        },
      });
      if (epoch !== this._epoch) return;
      this.unavailable = false;
    } catch (err) {
      if (epoch !== this._epoch) return;
      if (isAbort(err, signal)) return;
      if (err instanceof ApiError && err.status === 503) this.unavailable = true;
      else if (err instanceof ApiError && err.status === 409) this.error = agentDockText.busy;
      else this.error = humanError(err);
      if (!sawEvent) this._rollback(rollback);
    } finally {
      if (epoch === this._epoch) {
        const stoppedEarly = signal.aborted && !calledStream;
        this.streaming = false;
        this.statusText = null;
        if (this._turnAbort?.signal === signal) this._turnAbort = null;
        if (stoppedEarly) this._rollback(rollback);
      }
    }
  }

  private _current(epoch: number, seq: number): boolean {
    return epoch === this._epoch && seq === this._loadSeq;
  }

  private async _loadSelected(id: string, epoch: number, seq: number): Promise<void> {
    try {
      const detail = await client.getAgentThread(id);
      if (!this._current(epoch, seq) || this.streaming) return;
      this.threadId = detail.thread.id;
      this.messages = detail.messages;
      this._upsertThread(detail.thread);
    } catch (err) {
      if (!this._current(epoch, seq)) return;
      this.error = humanError(err);
    }
  }

  private _clearMemory(): void {
    this._epoch += 1;
    this._loadSeq += 1;
    this._turnAbort?.abort();
    this._turnAbort = null;
    this.open = false;
    this.threadId = null;
    this.threads = [];
    this.messages = [];
    this.draft = '';
    this.streaming = false;
    this.statusText = null;
    this.error = null;
    this.unavailable = false;
    this.pendingNav = null;
  }

  private _upsertThread(thread: AgentThread): void {
    const rest = this.threads.filter((item) => item.id !== thread.id);
    this.threads = [thread, ...rest].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  }

  private _rollback(rollback: TurnRollback): void {
    if (rollback.committed) this.messages = this.messages.slice(0, rollback.base);
    if (rollback.restoreDraft && this.draft.trim() === '') this.draft = rollback.text;
  }

  private _applyEvent(event: AgentSseEvent, slot: { id: string }): void {
    switch (event.event) {
      case 'status':
        this.statusText = event.data.phase === 'thinking' ? agentDockText.thinking : agentDockText.searching;
        return;
      case 'token':
        this.messages = this.messages.map((message) =>
          message.id === slot.id ? { ...message, content: message.content + event.data.text } : message,
        );
        return;
      case 'moments': {
        this.messages = this.messages.map((message) => {
          if (message.id !== slot.id) return message;
          const seen = new Set(message.moments.map((moment) => moment.id));
          const moments = [...message.moments];
          for (const moment of event.data.moments) {
            if (seen.has(moment.id)) continue;
            seen.add(moment.id);
            moments.push(moment);
          }
          return { ...message, moments };
        });
        return;
      }
      case 'navigate':
        this.pendingNav = event.data;
        return;
      case 'error':
        return;
      case 'done':
        this.messages = this.messages.map((message) => (message.id === slot.id ? event.data.message : message));
        slot.id = event.data.message.id;
        this.threadId = event.data.thread.id;
        this._upsertThread(event.data.thread);
        return;
    }
  }
}
