import { describe, expect, it } from 'vitest';
import { agentNavHref, agentPageContext, agentSuggestions, showAgentDock } from './visibility';

const ID = '11111111-1111-4111-8111-111111111111';

describe('showAgentDock', () => {
  it('未登录不出现', () => {
    expect(showAgentDock('/', false)).toBe(false);
    expect(showAgentDock('/moments/' + ID, false)).toBe(false);
  });

  it('邀请页和分享页不出现，其它已登录页面出现', () => {
    expect(showAgentDock('/invites', true)).toBe(false);
    expect(showAgentDock('/invites/', true)).toBe(false);
    expect(showAgentDock('/invites/tok', true)).toBe(false);
    expect(showAgentDock('/share', true)).toBe(false);
    expect(showAgentDock('/share/tok', true)).toBe(false);
    expect(showAgentDock('/', true)).toBe(true);
    expect(showAgentDock('/moments/' + ID, true)).toBe(true);
    expect(showAgentDock('/chains/' + ID, true)).toBe(true);
    expect(showAgentDock('/search', true)).toBe(true);
    expect(showAgentDock('/invitesomething', true)).toBe(true);
  });
});

describe('agentPageContext', () => {
  it('时刻页只带 momentId，链页和回顾页只带 chainId', () => {
    expect(agentPageContext(`/moments/${ID}`)).toEqual({ momentId: ID });
    expect(agentPageContext(`/chains/${ID}`)).toEqual({ chainId: ID });
    expect(agentPageContext(`/chains/${ID}/recaps/2026-10`)).toEqual({ chainId: ID });
    expect(agentPageContext(`/chains/${ID}/settings`)).toEqual({ chainId: ID });
    expect(agentPageContext('/')).toBeUndefined();
    expect(agentPageContext('/moments/not-a-uuid')).toBeUndefined();
    expect(agentPageContext('/chains')).toBeUndefined();
  });
});

describe('agentSuggestions', () => {
  it('按有没有页面上下文给三组建议句', () => {
    expect(agentSuggestions(undefined)).toEqual(['最近家里发生了什么', '我加入了哪些链']);
    expect(agentSuggestions({ chainId: ID })).toEqual(['这条链最近在记什么', '这条链最近的回顾说了什么']);
    expect(agentSuggestions({ momentId: ID })).toEqual(['和这条时刻相关的还有哪些']);
    expect(agentSuggestions({ chainId: ID, momentId: ID })).toEqual(['和这条时刻相关的还有哪些']);
  });
});

describe('agentNavHref', () => {
  it('导航到时刻、链和回顾，不收起面板由宿主保证', () => {
    expect(agentNavHref({ target: 'moment', momentId: ID })).toBe(`/moments/${ID}`);
    expect(agentNavHref({ target: 'chain', chainId: ID })).toBe(`/chains/${ID}`);
    expect(agentNavHref({ target: 'recap', chainId: ID, period: '2026-10' })).toBe(`/chains/${ID}/recaps/2026-10`);
  });
});
