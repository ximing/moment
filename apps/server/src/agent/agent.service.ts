import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentThread, MomentResponse, PostAgentTurnInput } from '@moment/dto';
import { and, desc, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { HttpError, NotFoundError } from 'routing-controllers';
import { Service } from 'typedi';
import { ChainPolicy } from '../chains/chain-policy.js';
import { ChainService } from '../chains/chain.service.js';
import { db } from '../db/index.js';
import { agentMessages, agentThreads, chains, type AgentMessageRow, type AgentThreadRow } from '../db/schema.js';
import type { LLMAgentChatRequest, LLMAgentMessage, LLMProvider } from '../llm/base.provider.js';
import { getLLMProvider } from '../llm/factory.js';
import { MomentService } from '../moments/moment.service.js';
import { RecapService } from '../recaps/recap.service.js';
import { SearchService } from '../search/search.service.js';
import { logger } from '../utils/logger.js';
import { buildAgentSystemPrompt } from './prompt.js';
import { AGENT_TOOLS, runAgentTool, type ToolOutcome } from './tools.js';

const LEASE_MS = 180_000;
const MAX_TOOL_ROUNDS = 2;
const HISTORY_LIMIT = 10;
const HISTORY_SLICE = 2000;
const MOMENT_CAP = 12;
const MODEL_TIMEOUT_MS = 40_000;
const NEW_TITLE = '新的对话';
const TITLE_CHARS = 24;
const CONTEXT_SLICE = 120;
const UPSTREAM_FALLBACK = '这次没能答完，可以再说一次。';

type AgentChat = NonNullable<LLMProvider['agentChat']>;

interface PreparedTurn {
  lease: Date;
}

@Service()
export class AgentService {
  constructor(
    private readonly search: SearchService,
    private readonly chains: ChainService,
    private readonly moments: MomentService,
    private readonly recaps: RecapService,
    private readonly policy: ChainPolicy,
  ) {}

  async create(userId: string): Promise<{ thread: AgentThread }> {
    const now = new Date();
    const id = randomUUID();
    await db.insert(agentThreads).values({
      id,
      userId,
      title: NEW_TITLE,
      generatingAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await db.select().from(agentThreads).where(eq(agentThreads.id, id)).limit(1);
    if (!row) throw new NotFoundError('THREAD_NOT_FOUND');
    return { thread: toThread(row) };
  }

  async list(userId: string): Promise<{ threads: AgentThread[] }> {
    const rows = await db
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.userId, userId))
      .orderBy(desc(agentThreads.updatedAt))
      .limit(30);
    return { threads: rows.map(toThread) };
  }

  async get(userId: string, threadId: string): Promise<{ thread: AgentThread; messages: AgentMessage[] }> {
    const row = await this.owned(userId, threadId);
    const recent = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.threadId, threadId))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(100);
    recent.reverse();
    const messages: AgentMessage[] = [];
    for (const message of recent) {
      messages.push(await this.toMessage(userId, message));
    }
    return { thread: toThread(row), messages };
  }

  async remove(userId: string, threadId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(agentThreads).where(eq(agentThreads.id, threadId)).limit(1).for('update');
      if (!row || row.userId !== userId) throw new NotFoundError('THREAD_NOT_FOUND');
      if (isLiveLease(row.generatingAt)) throw new HttpError(409, 'AGENT_THREAD_BUSY');
      await tx.delete(agentThreads).where(eq(agentThreads.id, threadId));
    });
  }

  /**
   * 流式一轮。行锁只留在短事务里；模型调用期间不占锁。
   * finally 只在 generating_at 仍等于本轮 lease 时清掉，避免拆掉下一轮已经拿走的租约。
   * 不监听 req close：express.json() 读完 body 后 Node 20 会提前触发，等于马上取消模型。
   */
  async streamTurn(userId: string, threadId: string, input: PostAgentTurnInput, res: Response): Promise<void> {
    await this.owned(userId, threadId);
    const provider = getLLMProvider();
    const agentChat = provider?.agentChat;
    if (!provider || !agentChat) throw new HttpError(503, 'AGENT_UNAVAILABLE');
    const pageContext = await this.pageContext(userId, input.context);
    const prepared = await this.prepare(userId, threadId, input.content);
    try {
      await this.emit(userId, threadId, pageContext, prepared.lease, agentChat.bind(provider), res);
    } finally {
      await this.release(threadId, prepared.lease);
    }
  }

  private async owned(userId: string, threadId: string): Promise<AgentThreadRow> {
    const [row] = await db.select().from(agentThreads).where(eq(agentThreads.id, threadId)).limit(1);
    if (!row || row.userId !== userId) throw new NotFoundError('THREAD_NOT_FOUND');
    return row;
  }

  private async prepare(userId: string, threadId: string, content: string): Promise<PreparedTurn> {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(agentThreads).where(eq(agentThreads.id, threadId)).limit(1).for('update');
      if (!row || row.userId !== userId) throw new NotFoundError('THREAD_NOT_FOUND');
      if (isLiveLease(row.generatingAt)) throw new HttpError(409, 'AGENT_THREAD_BUSY');
      const lease = new Date();
      const title = row.title === NEW_TITLE ? firstChars(content, TITLE_CHARS) : row.title;
      await tx
        .update(agentThreads)
        .set({ generatingAt: lease, title, updatedAt: lease })
        .where(eq(agentThreads.id, threadId));
      await tx.insert(agentMessages).values({
        id: randomUUID(),
        threadId,
        role: 'user',
        content,
        momentIds: null,
        createdAt: lease,
      });
      return { lease };
    });
  }

  /** 只在库里的 generating_at 仍等于本轮 lease 时清锁，并刷新 updatedAt。 */
  private async release(threadId: string, lease: Date): Promise<void> {
    await db
      .update(agentThreads)
      .set({ generatingAt: null, updatedAt: new Date() })
      .where(and(eq(agentThreads.id, threadId), eq(agentThreads.generatingAt, lease)));
  }

  private async pageContext(userId: string, context: PostAgentTurnInput['context']): Promise<string> {
    if (!context) return '';
    const lines: string[] = [];
    if (context.chainId) {
      try {
        await this.policy.require(userId, context.chainId, 'viewer');
        const [chain] = await db.select({ name: chains.name }).from(chains).where(eq(chains.id, context.chainId)).limit(1);
        if (chain) lines.push(`当前页面在链「${chain.name}」（chain:${context.chainId}）。`);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
      }
    }
    if (context.momentId) {
      try {
        const moment = await this.moments.get(userId, context.momentId);
        lines.push(
          `当前页面在时刻 moment:${moment.id}，日期 ${moment.happenedAt}，作者 ${moment.author.nickname}，正文：${moment.content.slice(0, CONTEXT_SLICE)}`,
        );
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
      }
    }
    return lines.join('\n');
  }

  private async emit(
    userId: string,
    threadId: string,
    pageContext: string,
    lease: Date,
    agentChat: AgentChat,
    res: Response,
  ): Promise<void> {
    const clientAbort = new AbortController();
    const onClose = (): void => {
      if (!res.writableFinished) clientAbort.abort();
    };
    const history = await this.recentHistory(threadId);
    const messages: LLMAgentMessage[] = [
      { role: 'system', content: buildAgentSystemPrompt(pageContext) },
      ...history,
    ];
    const cards: MomentResponse[] = [];
    const seen = new Set<string>();
    let assistantText = '';
    let upstream = false;

    this.beginSse(res);
    res.on('close', onClose);
    const writeEvent = (name: string, data: unknown): void => {
      if (clientAbort.signal.aborted || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientAbort.abort();
      }
    };
    const takeCards = (incoming: MomentResponse[]): void => {
      const fresh: MomentResponse[] = [];
      for (const moment of incoming) {
        if (seen.has(moment.id) || seen.size >= MOMENT_CAP) continue;
        seen.add(moment.id);
        cards.push(moment);
        fresh.push(moment);
      }
      if (fresh.length > 0) writeEvent('moments', { moments: fresh });
    };

    try {
      let toolRounds = 0;
      while (!clientAbort.signal.aborted) {
        writeEvent('status', { phase: 'thinking' });
        const allowTools = toolRounds < MAX_TOOL_ROUNDS;
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        let roundText = '';
        const request: LLMAgentChatRequest = {
          messages,
          maxTokens: 800,
          temperature: 0.3,
          signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
          ...(allowTools ? { tools: AGENT_TOOLS } : {}),
        };
        try {
          for await (const event of agentChat(request)) {
            if (clientAbort.signal.aborted) break;
            if (event.type === 'text' && event.text) {
              roundText += event.text;
              assistantText += event.text;
              writeEvent('token', { text: event.text });
            } else if (event.type === 'tool_call') {
              toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
            }
          }
        } catch (err) {
          if (clientAbort.signal.aborted) break;
          upstream = true;
          logger.warn('agent upstream failed', err instanceof Error ? err.name : 'error');
          break;
        }
        if (clientAbort.signal.aborted) break;
        if (toolCalls.length === 0 || !allowTools) break;
        messages.push({ role: 'assistant', content: roundText, toolCalls });
        for (let i = 0; i < toolCalls.length; i += 1) {
          const call = toolCalls[i]!;
          if (clientAbort.signal.aborted) break;
          writeEvent('status', { phase: 'tool', name: call.name });
          let outcome: ToolOutcome;
          try {
            outcome = await runAgentTool(
              {
                userId,
                search: this.search,
                chains: this.chains,
                moments: this.moments,
                recaps: this.recaps,
                policy: this.policy,
              },
              call.name,
              call.arguments,
            );
          } catch (err) {
            if (clientAbort.signal.aborted) break;
            // HttpError 已在工具内变成错误文本。其余失败同样留在这一轮，不能在头已发出后跳过 done。
            logger.warn('agent tool failed', err instanceof Error ? err.name : 'error');
            outcome = { text: '错误：INTERNAL' };
          }
          if (outcome.moments?.length) takeCards(outcome.moments);
          if (outcome.navigate) writeEvent('navigate', outcome.navigate);
          messages.push({ role: 'tool', toolCallId: call.id || `call_${toolRounds}_${i}`, content: outcome.text });
        }
        if (clientAbort.signal.aborted) break;
        toolRounds += 1;
      }

      const disconnected = clientAbort.signal.aborted;
      const hasOutput = assistantText.length > 0 || cards.length > 0;
      if (disconnected && !hasOutput) return;

      let content = assistantText;
      if (!disconnected && upstream && !content) content = UPSTREAM_FALLBACK;
      if (!disconnected && upstream) writeEvent('error', { code: 'AGENT_UPSTREAM' });

      const saved = await this.saveAssistant(threadId, content, cards);
      if (!saved) return;
      // 先按本轮 lease 清锁，done 里的 thread 才不是「仍在回答」。租约已被下一轮换掉时这里匹配不到。
      await this.release(threadId, lease);
      if (clientAbort.signal.aborted) return;
      const [fresh] = await db.select().from(agentThreads).where(eq(agentThreads.id, threadId)).limit(1);
      if (!fresh) return;
      writeEvent('done', { message: saved, thread: toThread(fresh) });
    } finally {
      res.off('close', onClose);
      if (res.headersSent && !res.writableEnded) res.end();
    }
  }

  private beginSse(res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': ok\n\n');
  }

  private async recentHistory(threadId: string): Promise<LLMAgentMessage[]> {
    const rows = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.threadId, threadId))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(HISTORY_LIMIT);
    rows.reverse();
    return rows.map((row): LLMAgentMessage =>
      row.role === 'assistant'
        ? { role: 'assistant', content: row.content.slice(0, HISTORY_SLICE) }
        : { role: 'user', content: row.content.slice(0, HISTORY_SLICE) },
    );
  }

  /** 线程行已经不在时返回 null，调用方结束响应且不写 done。 */
  private async saveAssistant(threadId: string, content: string, cards: MomentResponse[]): Promise<AgentMessage | null> {
    const [existing] = await db.select().from(agentThreads).where(eq(agentThreads.id, threadId)).limit(1);
    if (!existing) return null;
    const now = new Date();
    const id = randomUUID();
    const momentIds = cards.map((card) => card.id);
    try {
      await db.insert(agentMessages).values({
        id,
        threadId,
        role: 'assistant',
        content,
        momentIds: momentIds.length > 0 ? momentIds : null,
        createdAt: now,
      });
      await db.update(agentThreads).set({ updatedAt: now }).where(eq(agentThreads.id, threadId));
    } catch (err) {
      if (isMissingThread(err)) return null;
      throw err;
    }
    const message: AgentMessage = {
      id,
      threadId,
      role: 'assistant',
      content,
      moments: cards,
      createdAt: now.toISOString(),
    };
    return message;
  }

  private async toMessage(userId: string, row: AgentMessageRow): Promise<AgentMessage> {
    return {
      id: row.id,
      threadId: row.threadId,
      role: row.role,
      content: row.content,
      moments: await this.cardsFor(userId, momentIdList(row.momentIds)),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async cardsFor(userId: string, ids: string[]): Promise<MomentResponse[]> {
    const out: MomentResponse[] = [];
    for (const id of ids) {
      try {
        out.push(await this.moments.get(userId, id));
      } catch (err) {
        if (err instanceof HttpError) continue;
        throw err;
      }
    }
    return out;
  }
}

function isLiveLease(generatingAt: Date | null): boolean {
  return generatingAt !== null && Date.now() - generatingAt.getTime() < LEASE_MS;
}

function firstChars(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

function toThread(row: AgentThreadRow): AgentThread {
  return {
    id: row.id,
    title: row.title,
    generatingAt: row.generatingAt ? row.generatingAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function momentIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isMissingThread(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } }).code
    ?? (err as { cause?: { code?: string } }).cause?.code;
  return code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_NO_REFERENCED_ROW';
}
