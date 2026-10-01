import { Service } from '@rabjs/react';
import { ApiError } from '@moment/api-client';
import type {
  AgentMessage,
  AgentNavigate,
  AgentSseEvent,
  AgentThread,
  MomentResponse,
  PostAgentTurnInput,
  UserProfile,
} from '@moment/dto';
import { client } from '@/api/client';

/** 只持久化面板开关和当前线程。消息一律回服务端拉，避免和另一端分叉。 */
const STORAGE_KEY = 'moment.agent.dock';

const UPSTREAM_COPY = '这次没能答完，可以再说一次。';
const BUSY_COPY = '这条对话正在回答';

export type AgentPageContext = {
  chainId?: string;
  momentId?: string;
};

type PersistedDock = { open: boolean; threadId: string | null };

function dockStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPersisted(): PersistedDock {
  const storage = dockStorage();
  if (!storage) return { open: false, threadId: null };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, threadId: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { open: false, threadId: null };
    const record = parsed as { open?: unknown; threadId?: unknown };
    return {
      open: record.open === true,
      threadId: typeof record.threadId === 'string' && record.threadId ? record.threadId : null,
    };
  } catch {
    return { open: false, threadId: null };
  }
}

function turnInput(content: string, context?: AgentPageContext): PostAgentTurnInput {
  const next: { chainId?: string; momentId?: string } = {};
  if (context?.chainId) next.chainId = context.chainId;
  if (context?.momentId) next.momentId = context.momentId;
  if (next.chainId || next.momentId) return { content, context: next };
  return { content };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function localMessage(
  role: 'user' | 'assistant',
  content: string,
  threadId: string | null,
  moments: MomentResponse[],
): AgentMessage {
  return {
    id: `local-${role}-${crypto.randomUUID()}`,
    threadId: threadId ?? '',
    role,
    content,
    moments,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 全局问问时刻（spec §6）。不引用 router：导航只写入 pendingNav，由壳层组件消费。
 * 构造里不拉线程——壳层测试的 client 桩对未知方法永不 settle，构造期请求会把用例挂死。
 * 列表在面板打开时再拉。
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
  /** 本轮尚未被 done 替换的助手正文。 */
  liveContent = '';
  /** 本轮卡片，按 id 去重保序。 */
  liveMoments: MomentResponse[] = [];

  private turnSeq = 0;
  private loadSeq = 0;
  private abortController: AbortController | null = null;

  constructor() {
    super();
    const persisted = readPersisted();
    this.open = persisted.open;
    this.threadId = persisted.threadId;
    this.on(
      'auth:changed',
      (user: UserProfile | null) => {
        if (user === null) this.clearSession();
      },
      'global',
    );
  }

  toggle(): void {
    this.open = !this.open;
    this.persist();
  }

  close(): void {
    this.open = false;
    this.persist();
  }

  /** 面板挂载时调用。重复进入会再拉一次列表；有 threadId 再拉该线程。 */
  async loadOnOpen(): Promise<void> {
    if (!this.open || this.streaming) return;
    const seq = ++this.loadSeq;
    try {
      const { threads } = await client.listAgentThreads();
      if (seq !== this.loadSeq || !this.open || this.streaming) return;
      this.threads = threads;
      const threadId = this.threadId;
      if (!threadId) return;
      const loaded = await client.getAgentThread(threadId);
      if (seq !== this.loadSeq || !this.open || this.streaming || this.threadId !== threadId) return;
      this.messages = loaded.messages;
      this.upsertThread(loaded.thread);
    } catch (err) {
      if (seq !== this.loadSeq || !this.open) return;
      if (err instanceof ApiError && err.status === 404) {
        this.threadId = null;
        this.messages = [];
        this.persist();
      }
    }
  }

  startNew(): void {
    if (this.streaming) return;
    this.loadSeq += 1;
    this.threadId = null;
    this.messages = [];
    this.liveContent = '';
    this.liveMoments = [];
    this.error = null;
    this.persist();
  }

  async selectThread(id: string): Promise<void> {
    if (this.streaming) return;
    const seq = ++this.loadSeq;
    this.threadId = id;
    this.messages = [];
    this.error = null;
    this.persist();
    try {
      const loaded = await client.getAgentThread(id);
      if (seq !== this.loadSeq || this.threadId !== id) return;
      this.messages = loaded.messages;
      this.upsertThread(loaded.thread);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      if (err instanceof ApiError && err.status === 409) this.error = BUSY_COPY;
    }
  }

  async deleteThread(id: string): Promise<void> {
    if (this.streaming) return;
    try {
      await client.deleteAgentThread(id);
      this.threads = this.threads.filter((item) => item.id !== id);
      if (this.threadId === id) {
        this.threadId = null;
        this.messages = [];
        this.persist();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) this.error = BUSY_COPY;
    }
  }

  /** 发送期间忽略再次发送。context 原样交给服务端，不在这里补 chainId。 */
  async send(content: string, context?: AgentPageContext): Promise<void> {
    if (this.streaming) return;
    const text = content.trim();
    if (!text) return;

    const turn = ++this.turnSeq;
    this.loadSeq += 1;
    this.streaming = true;
    this.error = null;
    this.statusText = '正在想…';
    this.liveContent = '';
    this.liveMoments = [];
    this.draft = '';
    this.messages = [...this.messages, localMessage('user', text, this.threadId, [])];

    const controller = new AbortController();
    this.abortController = controller;
    let doneSeen = false;
    let produced = false;

    try {
      let threadId = this.threadId;
      if (!threadId) {
        const created = await client.createAgentThread();
        if (turn !== this.turnSeq) return;
        threadId = created.thread.id;
        this.threadId = created.thread.id;
        this.upsertThread(created.thread);
        this.persist();
      }
      await client.streamAgentTurn(threadId, turnInput(text, context), {
        signal: controller.signal,
        onEvent: (event) => {
          if (turn !== this.turnSeq) return;
          if (event.event === 'token' || event.event === 'moments' || event.event === 'done') produced = true;
          if (event.event === 'done') doneSeen = true;
          this.applyEvent(event);
        },
      });
    } catch (err) {
      if (turn !== this.turnSeq) return;
      if (isAbortError(err)) {
        // 停止：已有正文留在 finally 里
      } else if (err instanceof ApiError && err.status === 503) {
        this.unavailable = true;
        if (!produced) {
          this.rollbackLocalUser();
          this.draft = text;
        }
      } else if (err instanceof ApiError && err.status === 409) {
        this.error = BUSY_COPY;
        if (!produced) {
          this.rollbackLocalUser();
          this.draft = text;
        }
      } else {
        this.error = UPSTREAM_COPY;
      }
    } finally {
      if (turn !== this.turnSeq) return;
      if (!doneSeen && (this.liveContent || this.liveMoments.length > 0)) {
        this.messages = [
          ...this.messages,
          localMessage('assistant', this.liveContent, this.threadId, this.liveMoments),
        ];
      }
      this.liveContent = '';
      this.liveMoments = [];
      this.streaming = false;
      this.statusText = null;
      if (this.abortController === controller) this.abortController = null;
    }
  }

  stop(): void {
    this.abortController?.abort();
  }

  ackNav(): void {
    this.pendingNav = null;
  }

  private applyEvent(event: AgentSseEvent): void {
    switch (event.event) {
      case 'status':
        this.statusText = event.data.phase === 'tool' ? '正在检索…' : '正在想…';
        break;
      case 'token':
        this.liveContent += event.data.text;
        this.unavailable = false;
        this.statusText = null;
        break;
      case 'moments': {
        const seen = new Set(this.liveMoments.map((moment) => moment.id));
        const next = [...this.liveMoments];
        for (const moment of event.data.moments) {
          if (seen.has(moment.id)) continue;
          seen.add(moment.id);
          next.push(moment);
        }
        this.liveMoments = next;
        break;
      }
      case 'navigate':
        this.pendingNav = event.data;
        break;
      case 'error':
        if (event.data.code === 'AGENT_UPSTREAM') this.error = UPSTREAM_COPY;
        break;
      case 'done': {
        const { message, thread } = event.data;
        this.messages = [...this.messages, message];
        this.liveContent = '';
        this.liveMoments = [];
        this.threadId = thread.id;
        this.unavailable = false;
        this.upsertThread(thread);
        this.persist();
        break;
      }
    }
  }

  private rollbackLocalUser(): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === 'user' && last.id.startsWith('local-user-')) {
      this.messages = this.messages.slice(0, -1);
    }
  }

  private upsertThread(thread: AgentThread): void {
    const rest = this.threads.filter((item) => item.id !== thread.id);
    this.threads = [thread, ...rest].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  private persist(): void {
    const storage = dockStorage();
    if (!storage) return;
    const payload: PersistedDock = { open: this.open, threadId: this.threadId };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  private clearSession(): void {
    this.turnSeq += 1;
    this.loadSeq += 1;
    this.abortController?.abort();
    this.abortController = null;
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
    this.liveContent = '';
    this.liveMoments = [];
    dockStorage()?.removeItem(STORAGE_KEY);
  }
}
