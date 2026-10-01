import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { setEmbeddingProvider } from '../../src/embedding/factory.js';
import { setLLMProvider } from '../../src/llm/factory.js';
import type { LLMAgentChatRequest, LLMProvider } from '../../src/llm/base.provider.js';
import { db } from '../../src/db/index.js';
import { agentMessages, agentThreads } from '../../src/db/schema.js';
import { SearchService } from '../../src/search/search.service.js';
import { setStorageAdapter } from '../../src/storage/factory.js';
import { closeDb, resetDb } from '../helpers/db.js';
import { app, createChain, insertMoment, registerUser } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/storage.js';

beforeEach(resetDb);
afterAll(closeDb);

beforeEach(() => {
  installMockStorage();
  setEmbeddingProvider(null);
});

afterEach(() => {
  setStorageAdapter(null);
  setLLMProvider(undefined);
  setEmbeddingProvider(undefined);
  jest.restoreAllMocks();
});

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function chatOk(): Pick<LLMProvider, 'chat'> {
  return {
    async chat() {
      return { content: 'not-json', model: 'm', usage: { prompt: 0, completion: 0, total: 0 } };
    },
  };
}

function textAgent(text: string, observe?: (signal: AbortSignal | undefined) => Promise<void> | void): LLMProvider {
  return {
    ...chatOk(),
    async *agentChat(req) {
      await observe?.(req.signal);
      yield { type: 'text', text };
      yield { type: 'done' };
    },
  };
}

function toolThenText(
  call: { name: string; arguments: string },
  text: string,
  seen?: LLMAgentChatRequest[],
): LLMProvider {
  let round = 0;
  return {
    ...chatOk(),
    async *agentChat(req) {
      seen?.push(req);
      round += 1;
      if (round === 1) {
        yield { type: 'tool_call', id: 'call_1', name: call.name, arguments: call.arguments };
        yield { type: 'done' };
        return;
      }
      yield { type: 'text', text };
      yield { type: 'done' };
    },
  };
}

describe('agent threads', () => {
  it('未登录列表与发送均 401', async () => {
    const list = await request(app).get('/api/agent/threads');
    expect(list.status).toBe(401);
    const turn = await request(app).post(`/api/agent/threads/${randomUUID()}/turns`).send({ content: '你好' });
    expect(turn.status).toBe(401);
  });

  it('别人的对话读、删、发送都是 404', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    setLLMProvider(textAgent('不会执行到'));
    const created = await request(app).post('/api/agent/threads').set(auth(owner.token)).send({});
    expect(created.status).toBe(201);
    const id = created.body.thread.id as string;

    const read = await request(app).get(`/api/agent/threads/${id}`).set(auth(other.token));
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('THREAD_NOT_FOUND');

    const turn = await request(app).post(`/api/agent/threads/${id}/turns`).set(auth(other.token)).send({ content: '你好' });
    expect(turn.status).toBe(404);
    expect(turn.body.error.code).toBe('THREAD_NOT_FOUND');

    const removed = await request(app).delete(`/api/agent/threads/${id}`).set(auth(other.token));
    expect(removed.status).toBe(404);
    expect(removed.body.error.code).toBe('THREAD_NOT_FOUND');
  });

  it('创建、列表按 updatedAt 倒序、第一条消息改标题、删除后 404', async () => {
    const user = await registerUser();
    const a = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const b = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.thread.title).toBe('新的对话');
    const idA = a.body.thread.id as string;
    const idB = b.body.thread.id as string;

    await db.update(agentThreads).set({ updatedAt: new Date('2020-01-01T00:00:00.000Z') }).where(eq(agentThreads.id, idA));
    await db.update(agentThreads).set({ updatedAt: new Date('2020-01-02T00:00:00.000Z') }).where(eq(agentThreads.id, idB));
    const listed = await request(app).get('/api/agent/threads').set(auth(user.token));
    expect(listed.status).toBe(200);
    expect(listed.body.threads.map((thread: { id: string }) => thread.id)).toEqual([idB, idA]);

    const content = '一二三四五六七八九十一二三四五六七八九十一二三四额外';
    setLLMProvider(textAgent('好'));
    const turn = await request(app).post(`/api/agent/threads/${idA}/turns`).set(auth(user.token)).send({ content });
    expect(turn.status).toBe(200);
    const after = await request(app).get(`/api/agent/threads/${idA}`).set(auth(user.token));
    expect(after.body.thread.title).toBe(Array.from(content).slice(0, 24).join(''));
    const ordered = await request(app).get('/api/agent/threads').set(auth(user.token));
    expect(ordered.body.threads[0].id).toBe(idA);

    const removed = await request(app).delete(`/api/agent/threads/${idA}`).set(auth(user.token));
    expect(removed.status).toBe(204);
    const gone = await request(app).get(`/api/agent/threads/${idA}`).set(auth(user.token));
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('THREAD_NOT_FOUND');
  });

  it('无 provider 或没有 agentChat 时发送 503，线程仍可读', async () => {
    const user = await registerUser();
    const created = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const id = created.body.thread.id as string;

    setLLMProvider(null);
    const missing = await request(app).post(`/api/agent/threads/${id}/turns`).set(auth(user.token)).send({ content: '你好' });
    expect(missing.status).toBe(503);
    expect(missing.body.error.code).toBe('AGENT_UNAVAILABLE');
    expect(missing.headers['content-type']).toMatch(/application\/json/);

    setLLMProvider({ ...chatOk() });
    const noStream = await request(app).post(`/api/agent/threads/${id}/turns`).set(auth(user.token)).send({ content: '你好' });
    expect(noStream.status).toBe(503);
    expect(noStream.body.error.code).toBe('AGENT_UNAVAILABLE');

    const still = await request(app).get(`/api/agent/threads/${id}`).set(auth(user.token));
    expect(still.status).toBe(200);
    expect(still.body.thread.id).toBe(id);
    expect(still.body.messages).toEqual([]);
  });

  it('流式响应是 text/event-stream，含 token 与 done，且不是一个 JSON 对象', async () => {
    const user = await registerUser();
    const created = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const id = created.body.thread.id as string;
    let abortedAtStart: boolean | null = null;
    let abortedLater: boolean | null = null;
    setLLMProvider(textAgent('你好呀', async (signal) => {
      abortedAtStart = signal?.aborted ?? false;
      await new Promise((resolve) => setTimeout(resolve, 30));
      abortedLater = signal?.aborted ?? false;
    }));

    const res = await request(app).post(`/api/agent/threads/${id}/turns`).set(auth(user.token)).send({ content: '在吗' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text.startsWith(': ok\n\n')).toBe(true);
    expect(res.text).toContain('event: token');
    expect(res.text).toContain('你好呀');
    expect(res.text).toContain('event: done');
    expect(() => JSON.parse(res.text)).toThrow();
    expect(abortedAtStart).toBe(false);
    expect(abortedLater).toBe(false);

    const again = await request(app).post(`/api/agent/threads/${id}/turns`).set(auth(user.token)).send({ content: '再来' });
    expect(again.status).toBe(200);
  });

  it('search_moments：不带 chainId、别人的链、自己的链，以及页面上下文不变成 chainIds', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const mine = await createChain(owner.id, '家庭');
    const foreign = await createChain(other.id, '别人的');
    const momentId = await insertMoment({
      chainId: mine,
      authorId: owner.id,
      happenedAt: new Date('2026-08-10T00:00:00.000Z'),
      content: '周末野餐',
    });
    const created = await request(app).post('/api/agent/threads').set(auth(owner.token)).send({});
    const threadId = created.body.thread.id as string;
    const search = jest.spyOn(SearchService.prototype, 'search');

    const seen: LLMAgentChatRequest[] = [];
    setLLMProvider(toolThenText({ name: 'search_moments', arguments: JSON.stringify({ q: '野餐' }) }, '找到了', seen));
    const allChains = await request(app)
      .post(`/api/agent/threads/${threadId}/turns`)
      .set(auth(owner.token))
      .send({ content: '找野餐', context: { chainId: mine } });
    expect(allChains.status).toBe(200);
    expect(allChains.text).toContain('event: moments');
    expect(allChains.text).toContain(momentId);
    expect(allChains.text).toContain('event: done');
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[1]).toMatchObject({ q: '野餐', tzOffset: -480, limit: 8 });
    expect(search.mock.calls[0]?.[1].chainIds).toBeUndefined();
    expect(seen[0]?.messages[0]).toMatchObject({ role: 'system' });
    expect((seen[0]?.messages[0] as { content: string }).content).toContain('家庭');

    const got = await request(app).get(`/api/agent/threads/${threadId}`).set(auth(owner.token));
    const assistant = got.body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant.moments.map((moment: { id: string }) => moment.id)).toEqual([momentId]);
    expect(assistant.content).toContain('找到了');

    await db
      .update(agentMessages)
      .set({ momentIds: [momentId, randomUUID()] })
      .where(eq(agentMessages.id, assistant.id));
    const reread = await request(app).get(`/api/agent/threads/${threadId}`).set(auth(owner.token));
    const again = reread.body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(again.moments.map((moment: { id: string }) => moment.id)).toEqual([momentId]);
    expect(again.content).toContain('找到了');

    search.mockClear();
    setLLMProvider(toolThenText({ name: 'search_moments', arguments: JSON.stringify({ q: '野餐', chainId: foreign }) }, '没有'));
    const foreignTurn = await request(app)
      .post(`/api/agent/threads/${threadId}/turns`)
      .set(auth(owner.token))
      .send({ content: '别人的链' });
    expect(foreignTurn.status).toBe(200);
    expect(foreignTurn.text).not.toContain('event: moments');
    expect(foreignTurn.text).toContain('event: done');
    expect(search).not.toHaveBeenCalled();

    search.mockClear();
    setLLMProvider(toolThenText({ name: 'search_moments', arguments: JSON.stringify({ q: '野餐', chainId: mine }) }, '自家'));
    const ownTurn = await request(app)
      .post(`/api/agent/threads/${threadId}/turns`)
      .set(auth(owner.token))
      .send({ content: '自家' });
    expect(ownTurn.status).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[1].chainIds).toEqual([mine]);
    expect(search.mock.calls[0]?.[1].tzOffset).toBe(-480);
    expect(search.mock.calls[0]?.[1].limit).toBe(8);
  });

  it('navigate 指向别人的时刻时不发 navigate，流仍以 done 结束', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const foreignChain = await createChain(other.id);
    const foreignMoment = await insertMoment({
      chainId: foreignChain,
      authorId: other.id,
      happenedAt: new Date('2026-08-11T00:00:00.000Z'),
      content: '别人的时刻',
    });
    const created = await request(app).post('/api/agent/threads').set(auth(owner.token)).send({});
    const threadId = created.body.thread.id as string;
    setLLMProvider(
      toolThenText(
        { name: 'navigate', arguments: JSON.stringify({ target: 'moment', momentId: foreignMoment }) },
        '打不开',
      ),
    );
    const res = await request(app).post(`/api/agent/threads/${threadId}/turns`).set(auth(owner.token)).send({ content: '打开' });
    expect(res.status).toBe(200);
    expect(res.text.split('\n').some((line) => line.startsWith('event: navigate'))).toBe(false);
    expect(res.text).toContain('event: done');
  });

  it('read_recap 遇到不存在的链时以工具错误结束并写 done', async () => {
    const user = await registerUser();
    const created = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const threadId = created.body.thread.id as string;
    const seen: LLMAgentChatRequest[] = [];
    setLLMProvider(
      toolThenText({ name: 'read_recap', arguments: JSON.stringify({ chainId: randomUUID() }) }, '回声', seen),
    );
    const original = seen;
    const provider = {
      ...chatOk(),
      async *agentChat(req: LLMAgentChatRequest) {
        original.push(req);
        if (original.length === 1) {
          yield { type: 'tool_call' as const, id: 'call_1', name: 'read_recap', arguments: JSON.stringify({ chainId: randomUUID() }) };
          yield { type: 'done' as const };
          return;
        }
        const tool = req.messages.find((message) => message.role === 'tool');
        const echoed = tool && tool.role === 'tool' ? tool.content : '';
        yield { type: 'text' as const, text: echoed };
        yield { type: 'done' as const };
      },
    };
    setLLMProvider(provider);
    const res = await request(app).post(`/api/agent/threads/${threadId}/turns`).set(auth(user.token)).send({ content: '回顾' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('错误：CHAIN_NOT_FOUND');
    expect(res.text).not.toContain('event: error');
  });

  it('工具抛出非 HttpError 时变成错误文本，流仍以 done 结束并保存助手消息', async () => {
    const user = await registerUser();
    const created = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const threadId = created.body.thread.id as string;
    jest.spyOn(SearchService.prototype, 'search').mockRejectedValue(new Error('lance down'));
    const seen: LLMAgentChatRequest[] = [];
    setLLMProvider({
      ...chatOk(),
      async *agentChat(req) {
        seen.push(req);
        if (seen.length === 1) {
          yield { type: 'tool_call', id: 'call_1', name: 'search_moments', arguments: JSON.stringify({ q: '银杏' }) };
          yield { type: 'done' };
          return;
        }
        const tool = req.messages.find((message) => message.role === 'tool');
        yield { type: 'text', text: tool && tool.role === 'tool' ? tool.content : '' };
        yield { type: 'done' };
      },
    });
    const res = await request(app).post(`/api/agent/threads/${threadId}/turns`).set(auth(user.token)).send({ content: '找银杏' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('错误：INTERNAL');
    expect(res.text).toContain('event: done');
    expect(res.text).not.toContain('event: error');
    const got = await request(app).get(`/api/agent/threads/${threadId}`).set(auth(user.token));
    const assistant = got.body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant.content).toContain('错误：INTERNAL');
  });

  it('活租约内再次发送与删除都是 409，线程还在', async () => {
    const user = await registerUser();
    const created = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const threadId = created.body.thread.id as string;
    let release = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = (): void => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    setLLMProvider({
      ...chatOk(),
      async *agentChat() {
        started();
        await hold;
        yield { type: 'text', text: '晚到' };
        yield { type: 'done' };
      },
    });
    const first = request(app).post(`/api/agent/threads/${threadId}/turns`).set(auth(user.token)).send({ content: '第一轮' });
    // supertest 要等到 then/end 才真正发出请求。
    const finished = first.then((res) => res);
    try {
      await ready;
      const second = await request(app).post(`/api/agent/threads/${threadId}/turns`).set(auth(user.token)).send({ content: '第二轮' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('AGENT_THREAD_BUSY');
      const removed = await request(app).delete(`/api/agent/threads/${threadId}`).set(auth(user.token));
      expect(removed.status).toBe(409);
      expect(removed.body.error.code).toBe('AGENT_THREAD_BUSY');
      const still = await request(app).get(`/api/agent/threads/${threadId}`).set(auth(user.token));
      expect(still.status).toBe(200);
      expect(still.body.thread.id).toBe(threadId);
    } finally {
      release();
    }
    const done = await finished;
    expect(done.status).toBe(200);
    expect(done.text).toContain('event: done');
  });

  it('客户端中止后留下已输出文本，且只清本轮租约', async () => {
    const user = await registerUser();
    const created = await request(app).post('/api/agent/threads').set(auth(user.token)).send({});
    const threadId = created.body.thread.id as string;
    let holding = (): void => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    setLLMProvider({
      ...chatOk(),
      async *agentChat(req) {
        yield { type: 'text', text: '部分回答' };
        holding();
        await new Promise<void>((resolve) => {
          if (req.signal?.aborted) {
            resolve();
            return;
          }
          req.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });

    const pending = openTurn(app, `/api/agent/threads/${threadId}/turns`, user.token, { content: '停一下' });
    await held;
    const stolen = new Date('2030-01-01T00:00:00.000Z');
    await db.update(agentThreads).set({ generatingAt: stolen }).where(eq(agentThreads.id, threadId));
    pending.abort();
    await pending.done;

    const [row] = await db.select().from(agentThreads).where(eq(agentThreads.id, threadId)).limit(1);
    expect(row?.generatingAt?.toISOString()).toBe(stolen.toISOString());
    const got = await request(app).get(`/api/agent/threads/${threadId}`).set(auth(user.token));
    expect(got.status).toBe(200);
    const assistant = got.body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant.content).toContain('部分回答');
    const userMessage = got.body.messages.find((message: { role: string }) => message.role === 'user');
    expect(userMessage.content).toBe('停一下');
  });
});

function openTurn(
  server: Server,
  path: string,
  token: string,
  jsonBody: unknown,
): { abort: () => void; done: Promise<{ status: number; body: string }> } {
  const addr = server.address() as AddressInfo;
  const payload = JSON.stringify(jsonBody);
  const req = http.request({
    host: '127.0.0.1',
    port: addr.port,
    path,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      authorization: `Bearer ${token}`,
    },
  });
  let settled = false;
  const done = new Promise<{ status: number; body: string }>((resolve, reject) => {
    const finish = (status: number, body: string): void => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        finish(0, '');
        return;
      }
      if (!settled) reject(err);
    });
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', () => finish(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8')));
      res.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
          finish(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'));
          return;
        }
        if (!settled) reject(err);
      });
      res.on('aborted', () => finish(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8')));
    });
  });
  req.write(payload);
  req.end();
  return {
    abort: () => req.destroy(),
    done,
  };
}
