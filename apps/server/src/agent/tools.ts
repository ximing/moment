import type { AgentNavigate, MomentResponse } from '@moment/dto';
import type { LLMToolDef } from '../llm/base.provider.js';
import { eq } from 'drizzle-orm';
import { HttpError } from 'routing-controllers';
import { ChainPolicy } from '../chains/chain-policy.js';
import { ChainService } from '../chains/chain.service.js';
import { db } from '../db/index.js';
import { chains } from '../db/schema.js';
import { MomentService } from '../moments/moment.service.js';
import { RecapService } from '../recaps/recap.service.js';
import { SearchService } from '../search/search.service.js';

export const AGENT_TOOL_NAMES = ['search_moments', 'list_chains', 'get_moment', 'read_recap', 'navigate'] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const SEARCH_LIMIT = 8;
const SEARCH_TZ_OFFSET = -480;
const MOMENT_TEXT_MAX = 400;
const RECAP_TEXT_MAX = 1500;
const PERIOD_RE = /^\d{4}-\d{2}$/;

export const AGENT_TOOLS: LLMToolDef[] = [
  {
    name: 'search_moments',
    description: '检索当前用户已经能看的时刻。不传 chainId 就搜索他的全部链。不要把页面上下文自动填进 chainId。',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '检索语句，原样交给现有搜索' },
        chainId: { type: 'string', description: '可选。只搜这一条链时传链的 uuid' },
      },
      required: ['q'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_chains',
    description: '列出当前用户参与的链，只返回 id、name、myRole。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_moment',
    description: '读取一条时刻。无权、不存在或已删除时会得到错误文本。',
    parameters: {
      type: 'object',
      properties: { momentId: { type: 'string', description: '时刻 uuid' } },
      required: ['momentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_recap',
    description: '读取某条链的回顾。不传 period 时取最近一条 ready 或 degraded。',
    parameters: {
      type: 'object',
      properties: {
        chainId: { type: 'string', description: '链 uuid' },
        period: { type: 'string', description: '可选，YYYY-MM' },
      },
      required: ['chainId'],
      additionalProperties: false,
    },
  },
  {
    name: 'navigate',
    description: '请客户端打开时刻、链或回顾页。不修改任何数据。只有用户明确说打开时才调用。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['moment', 'chain', 'recap'] },
        momentId: { type: 'string' },
        chainId: { type: 'string' },
        period: { type: 'string', description: 'YYYY-MM，target=recap 时必填' },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
];

export interface ToolOutcome {
  text: string;
  moments?: MomentResponse[];
  navigate?: AgentNavigate;
}

export interface AgentToolDeps {
  userId: string;
  search: SearchService;
  chains: ChainService;
  moments: MomentService;
  recaps: RecapService;
  policy: ChainPolicy;
}

export async function runAgentTool(deps: AgentToolDeps, name: string, argsJson: string): Promise<ToolOutcome> {
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(argsJson || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: '错误：VALIDATION_ERROR' };
    args = parsed as Record<string, unknown>;
  } catch {
    return { text: '错误：VALIDATION_ERROR' };
  }
  try {
    switch (name) {
      case 'search_moments':
        return await searchMoments(deps, args);
      case 'list_chains':
        return await listChains(deps);
      case 'get_moment':
        return await getMoment(deps, args);
      case 'read_recap':
        return await readRecap(deps, args);
      case 'navigate':
        return await navigate(deps, args);
      default:
        return { text: '错误：UNKNOWN_TOOL' };
    }
  } catch (err) {
    if (err instanceof HttpError) return { text: httpErrorText(err) };
    throw err;
  }
}

function httpErrorText(err: HttpError): string {
  const code = /^[A-Z0-9_]+$/.test(err.message) ? err.message : err.name;
  return `错误：${code}`;
}

async function chainName(chainId: string): Promise<string> {
  const [row] = await db.select({ name: chains.name }).from(chains).where(eq(chains.id, chainId)).limit(1);
  return row?.name ?? '';
}

function formatMoment(moment: MomentResponse, name: string): string {
  const lines = [
    `id: ${moment.id}`,
    `链: ${name}`,
    `作者: ${moment.author.nickname}`,
    `时间: ${moment.happenedAt}`,
    `正文: ${moment.content.slice(0, MOMENT_TEXT_MAX)}`,
  ];
  if (moment.place?.name) lines.push(`地点: ${moment.place.name}`);
  const persons = moment.persons.map((person) => person.name).filter((person) => person.length > 0);
  if (persons.length > 0) lines.push(`人物: ${persons.join('、')}`);
  return lines.join('\n');
}

async function formatMoments(moments: MomentResponse[]): Promise<string> {
  if (moments.length === 0) return '没有找到时刻。';
  const blocks: string[] = [];
  for (const moment of moments) {
    blocks.push(formatMoment(moment, await chainName(moment.chainId)));
  }
  return blocks.join('\n\n');
}

async function searchMoments(deps: AgentToolDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    const q = typeof args.q === 'string' ? args.q.trim() : '';
    if (!q) return { text: '错误：VALIDATION_ERROR' };
    let chainIds: string[] | undefined;
    if (args.chainId !== undefined) {
      if (typeof args.chainId !== 'string' || args.chainId.length === 0) return { text: '错误：VALIDATION_ERROR' };
      const mine = await deps.chains.listMine(deps.userId);
      if (!mine.some((chain) => chain.id === args.chainId)) return { text: '错误：CHAIN_NOT_FOUND' };
      chainIds = [args.chainId];
    }
    const result = await deps.search.search(deps.userId, {
      q,
      tzOffset: SEARCH_TZ_OFFSET,
      limit: SEARCH_LIMIT,
      ...(chainIds ? { chainIds } : {}),
    });
    return { text: await formatMoments(result.moments), moments: result.moments };
  } catch (err) {
    if (err instanceof HttpError) return { text: httpErrorText(err) };
    throw err;
  }
}

async function listChains(deps: AgentToolDeps): Promise<ToolOutcome> {
  try {
    const rows = await deps.chains.listMine(deps.userId);
    const slim = rows.map((chain) => ({
      id: chain.id,
      name: chain.name,
      myRole: chain.myRole,
    }));
    return { text: JSON.stringify(slim) };
  } catch (err) {
    if (err instanceof HttpError) return { text: httpErrorText(err) };
    throw err;
  }
}

async function getMoment(deps: AgentToolDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    if (typeof args.momentId !== 'string' || args.momentId.length === 0) return { text: '错误：VALIDATION_ERROR' };
    const moment = await deps.moments.get(deps.userId, args.momentId);
    return { text: formatMoment(moment, await chainName(moment.chainId)), moments: [moment] };
  } catch (err) {
    if (err instanceof HttpError) return { text: httpErrorText(err) };
    throw err;
  }
}

function formatRecap(period: string, status: string, content: string): string {
  return [`period: ${period}`, `status: ${status}`, `正文: ${content.slice(0, RECAP_TEXT_MAX)}`].join('\n');
}

async function readRecap(deps: AgentToolDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    if (typeof args.chainId !== 'string' || args.chainId.length === 0) return { text: '错误：VALIDATION_ERROR' };
    await deps.policy.require(deps.userId, args.chainId, 'viewer');
    if (args.period !== undefined) {
      if (typeof args.period !== 'string' || !PERIOD_RE.test(args.period)) return { text: '错误：INVALID_PERIOD' };
      const recap = await deps.recaps.getByPeriod(args.chainId, args.period);
      if (recap.status !== 'ready' && recap.status !== 'degraded') return { text: '错误：RECAP_NOT_READY' };
      return { text: formatRecap(recap.period, recap.status, recap.content) };
    }
    const listed = await deps.recaps.list(args.chainId);
    const recap = listed.recaps.find((row) => row.status === 'ready' || row.status === 'degraded');
    if (!recap) return { text: '错误：RECAP_NOT_FOUND' };
    return { text: formatRecap(recap.period, recap.status, recap.content) };
  } catch (err) {
    if (err instanceof HttpError) return { text: httpErrorText(err) };
    throw err;
  }
}

async function navigate(deps: AgentToolDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    if (args.target === 'moment') {
      if (typeof args.momentId !== 'string') return { text: '错误：VALIDATION_ERROR' };
      await deps.moments.get(deps.userId, args.momentId);
      return { text: '可以打开这条时刻。', navigate: { target: 'moment', momentId: args.momentId } };
    }
    if (args.target === 'chain') {
      if (typeof args.chainId !== 'string') return { text: '错误：VALIDATION_ERROR' };
      await deps.policy.require(deps.userId, args.chainId, 'viewer');
      return { text: '可以打开这条链。', navigate: { target: 'chain', chainId: args.chainId } };
    }
    if (args.target === 'recap') {
      if (typeof args.chainId !== 'string' || typeof args.period !== 'string' || !PERIOD_RE.test(args.period)) {
        return { text: '错误：VALIDATION_ERROR' };
      }
      await deps.policy.require(deps.userId, args.chainId, 'viewer');
      const recap = await deps.recaps.getByPeriod(args.chainId, args.period);
      if (recap.status !== 'ready' && recap.status !== 'degraded') return { text: '错误：RECAP_NOT_READY' };
      return {
        text: '可以打开这篇回顾。',
        navigate: { target: 'recap', chainId: args.chainId, period: args.period },
      };
    }
    return { text: '错误：VALIDATION_ERROR' };
  } catch (err) {
    if (err instanceof HttpError) return { text: httpErrorText(err) };
    throw err;
  }
}
