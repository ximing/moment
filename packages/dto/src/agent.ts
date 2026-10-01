import { z } from 'zod';
import type { MomentResponse } from './moments.js';

/** POST /api/agent/threads/:id/turns。tzOffset 不在此 body 里。 */
export const postAgentTurnInputSchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
    context: z
      .object({
        chainId: z.string().uuid().optional(),
        momentId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PostAgentTurnInput = z.infer<typeof postAgentTurnInputSchema>;

/** POST /api/agent/threads。空对象，多余字段拒绝。 */
export const createAgentThreadInputSchema = z.object({}).strict();
export type CreateAgentThreadInput = z.infer<typeof createAgentThreadInputSchema>;

export interface AgentThread {
  id: string;
  title: string;
  /** 活租约的开始时间；没有在跑的轮次为 null */
  generatingAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 接口里的时刻是已鉴权的 MomentResponse；库存的是 id。 */
export interface AgentMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  moments: MomentResponse[];
  createdAt: string;
}

export type AgentNavigate =
  | { target: 'moment'; momentId: string }
  | { target: 'chain'; chainId: string }
  | { target: 'recap'; chainId: string; period: string };

export type AgentSseEvent =
  | { event: 'status'; data: { phase: 'thinking' } | { phase: 'tool'; name: string } }
  | { event: 'token'; data: { text: string } }
  | { event: 'moments'; data: { moments: MomentResponse[] } }
  | { event: 'navigate'; data: AgentNavigate }
  | { event: 'error'; data: { code: 'AGENT_UPSTREAM' } }
  | { event: 'done'; data: { message: AgentMessage; thread: AgentThread } };
