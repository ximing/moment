import type { AgentNavigate } from '@moment/dto';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface AgentPageContext {
  chainId?: string;
  momentId?: string;
}

function pathOnly(pathname: string): string {
  const bare = pathname.split('?')[0] ?? pathname;
  if (!bare) return '/';
  return bare.startsWith('/') ? bare : `/${bare}`;
}

/** 已登录，且不是邀请页、分享页。`/invites` 必须整段匹配，避免误伤其它路径。 */
export function showAgentDock(pathname: string, loggedIn: boolean): boolean {
  if (!loggedIn) return false;
  const path = pathOnly(pathname);
  if (path === '/invites' || path.startsWith('/invites/')) return false;
  if (path.startsWith('/share')) return false;
  return true;
}

/** 从当前 pathname 取页面上下文。时刻页只带 momentId，链页（含回顾）只带 chainId。 */
export function agentPageContext(pathname: string): AgentPageContext | undefined {
  const path = pathOnly(pathname);
  const moment = /^\/moments\/([^/]+)$/.exec(path);
  if (moment?.[1] && UUID_RE.test(moment[1])) return { momentId: moment[1] };
  const chain = /^\/chains\/([^/]+)(?:\/.*)?$/.exec(path);
  if (chain?.[1] && UUID_RE.test(chain[1])) return { chainId: chain[1] };
  return undefined;
}

export function agentSuggestions(context: AgentPageContext | undefined): readonly string[] {
  if (context?.momentId) return ['和这条时刻相关的还有哪些'];
  if (context?.chainId) return ['这条链最近在记什么', '这条链最近的回顾说了什么'];
  return ['最近家里发生了什么', '我加入了哪些链'];
}

export function agentNavHref(nav: AgentNavigate): string {
  switch (nav.target) {
    case 'moment':
      return `/moments/${nav.momentId}`;
    case 'chain':
      return `/chains/${nav.chainId}`;
    case 'recap':
      return `/chains/${nav.chainId}/recaps/${nav.period}`;
  }
}
