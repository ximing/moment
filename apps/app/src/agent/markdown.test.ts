import { describe, expect, it } from 'vitest';
import { agentMarkdownTarget, parseAgentMarkdown, type AgentMdBlock, type AgentMdInline, type AgentMdLink } from './markdown';

const ID = '11111111-1111-4111-8111-111111111111';

function walk(inlines: AgentMdInline[], found: AgentMdLink[]): void {
  for (const inline of inlines) {
    if (inline.type === 'link') found.push(inline);
    else if (inline.type === 'bold') walk(inline.children, found);
  }
}

function linksOf(source: string): AgentMdLink[] {
  const found: AgentMdLink[] = [];
  for (const block of parseAgentMarkdown(source)) {
    if (block.type === 'list') {
      for (const item of block.items) walk(item, found);
    } else {
      walk(block.inlines, found);
    }
  }
  return found;
}

function textOf(source: string): string {
  const chunks: string[] = [];
  const take = (inlines: AgentMdInline[]): void => {
    for (const inline of inlines) {
      if (inline.type === 'text' || inline.type === 'code' || inline.type === 'link') chunks.push(inline.text);
      else take(inline.children);
    }
  };
  for (const block of parseAgentMarkdown(source) as AgentMdBlock[]) {
    if (block.type === 'list') block.items.forEach(take);
    else take(block.inlines);
  }
  return chunks.join('');
}

describe('parseAgentMarkdown', () => {
  it('渲染加粗、行内代码和标题', () => {
    expect(parseAgentMarkdown('这是**加粗**和 `code`')).toEqual([
      {
        type: 'paragraph',
        inlines: [
          { type: 'text', text: '这是' },
          { type: 'bold', children: [{ type: 'text', text: '加粗' }] },
          { type: 'text', text: '和 ' },
          { type: 'code', text: 'code' },
        ],
      },
    ]);
    expect(parseAgentMarkdown('# 一级\n\n## 二级\n\n### 三级')).toEqual([
      { type: 'heading', level: 1, inlines: [{ type: 'text', text: '一级' }] },
      { type: 'heading', level: 2, inlines: [{ type: 'text', text: '二级' }] },
      { type: 'heading', level: 3, inlines: [{ type: 'text', text: '三级' }] },
    ]);
  });

  it('渲染无序列表和有序列表', () => {
    expect(parseAgentMarkdown('- 一\n- 二')).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: '一' }], [{ type: 'text', text: '二' }]],
      },
    ]);
    expect(parseAgentMarkdown('1. 甲\n2. 乙')).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [[{ type: 'text', text: '甲' }], [{ type: 'text', text: '乙' }]],
      },
    ]);
  });

  it('三种内部链接可点，http 单独打开，javascript: 和 moment:// 仍是文字', () => {
    const source = [
      `看 moment:${ID}`,
      `链 chain:${ID}`,
      `回顾 recap:${ID}/2026-10`,
      '外链 https://example.com/a。',
      '坏的 javascript:alert(1)',
      '方案 moment://invites/abc',
    ].join('\n');
    expect(linksOf(source)).toEqual([
      { type: 'link', kind: 'moment', id: ID, text: `moment:${ID}` },
      { type: 'link', kind: 'chain', id: ID, text: `chain:${ID}` },
      { type: 'link', kind: 'recap', id: ID, period: '2026-10', text: `recap:${ID}/2026-10` },
      { type: 'link', kind: 'http', href: 'https://example.com/a', text: 'https://example.com/a' },
    ]);
    expect(textOf(source)).toContain('javascript:alert(1)');
    expect(textOf(source)).toContain('moment://invites/abc');
    const links = linksOf(source);
    expect(agentMarkdownTarget(links[0]!).href).toBe(`/moments/${ID}`);
    expect(agentMarkdownTarget(links[0]!).external).toBe(false);
    expect(agentMarkdownTarget(links[1]!).href).toBe(`/chains/${ID}`);
    expect(agentMarkdownTarget(links[2]!).href).toBe(`/chains/${ID}/recaps/2026-10`);
    expect(agentMarkdownTarget(links[3]!)).toEqual({ external: true, href: 'https://example.com/a' });
  });

  it('代码里的内部链接不当成链接', () => {
    expect(linksOf(`看 \`moment:${ID}\``)).toEqual([]);
  });

  it('未闭合的标记不抛，按字面量留下', () => {
    expect(() => parseAgentMarkdown('**未闭合')).not.toThrow();
    expect(() => parseAgentMarkdown('`未闭合')).not.toThrow();
    expect(parseAgentMarkdown('**未闭合')).toEqual([
      { type: 'paragraph', inlines: [{ type: 'text', text: '**未闭合' }] },
    ]);
    expect(parseAgentMarkdown('半截 `code')).toEqual([
      { type: 'paragraph', inlines: [{ type: 'text', text: '半截 `code' }] },
    ]);
    expect(parseAgentMarkdown('')).toEqual([]);
  });
});
