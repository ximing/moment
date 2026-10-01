/**
 * 助手正文的安全子集。未闭合的 ** / ` 按字面量留下，流式半截不能抛。
 * 内部链接不是 URL：moment: / chain: / recap: 只交给宿主的 router.push。
 * moment:// 与 javascript: 保持字面量，不进链接。
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const LINK_RE = new RegExp(
  `(?<![A-Za-z0-9])(?:moment:(${UUID})|chain:(${UUID})|recap:(${UUID})/(\\d{4}-\\d{2})(?!\\d)|https?:\\/\\/[^\\s<>]+)`,
  'g',
);

const TRAILING_PUNCT = /[.,;:!?)>"'\]]+$|[。，、；：！？）】」』]+$/u;

export type AgentMdLink =
  | { type: 'link'; kind: 'moment'; id: string; text: string }
  | { type: 'link'; kind: 'chain'; id: string; text: string }
  | { type: 'link'; kind: 'recap'; id: string; period: string; text: string }
  | { type: 'link'; kind: 'http'; href: string; text: string };

export type AgentMdInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: AgentMdInline[] }
  | { type: 'code'; text: string }
  | AgentMdLink;

export type AgentMdBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: AgentMdInline[] }
  | { type: 'paragraph'; inlines: AgentMdInline[] }
  | { type: 'list'; ordered: boolean; items: AgentMdInline[][] };

export function parseAgentMarkdown(source: string): AgentMdBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: AgentMdBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', inlines: parseInlines(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    blocks.push({
      type: 'list',
      ordered: list.ordered,
      items: list.items.map((item) => parseInlines(item)),
    });
    list = null;
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const marks = heading[1] ?? '';
      const level = marks.length === 1 ? 1 : marks.length === 2 ? 2 : 3;
      blocks.push({ type: 'heading', level, inlines: parseInlines(heading[2] ?? '') });
      continue;
    }
    const unordered = /^- (.*)$/.exec(line);
    const ordered = /^(\d+)\. (.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = ordered !== null;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((unordered ? unordered[1] : ordered?.[2]) ?? '');
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** 内部链接变成应用内路径；http 留给 Linking.openURL。javascript: / moment:// 不会进到这里。 */
export function agentMarkdownTarget(link: AgentMdLink): { external: boolean; href: string } {
  if (link.kind === 'http') return { external: true, href: link.href };
  if (link.kind === 'moment') return { external: false, href: `/moments/${link.id}` };
  if (link.kind === 'chain') return { external: false, href: `/chains/${link.id}` };
  return { external: false, href: `/chains/${link.id}/recaps/${link.period}` };
}

function parseInlines(input: string): AgentMdInline[] {
  const out: AgentMdInline[] = [];
  let buffer = '';
  let i = 0;
  const flush = (): void => {
    if (!buffer) return;
    out.push(...linkify(buffer));
    buffer = '';
  };
  while (i < input.length) {
    if (input.startsWith('**', i)) {
      const end = input.indexOf('**', i + 2);
      if (end === -1) {
        buffer += '**';
        i += 2;
        continue;
      }
      flush();
      out.push({ type: 'bold', children: parseInlines(input.slice(i + 2, end)) });
      i = end + 2;
      continue;
    }
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end === -1) {
        buffer += '`';
        i += 1;
        continue;
      }
      flush();
      out.push({ type: 'code', text: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    buffer += input[i];
    i += 1;
  }
  flush();
  return out;
}

function linkify(text: string): AgentMdInline[] {
  const out: AgentMdInline[] = [];
  const re = new RegExp(LINK_RE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let raw = match[0];
    let end = match.index + raw.length;
    const http = raw.startsWith('http://') || raw.startsWith('https://');
    if (http) {
      const trimmed = raw.replace(TRAILING_PUNCT, '');
      if (trimmed.length > 0) {
        raw = trimmed;
        end = match.index + trimmed.length;
        re.lastIndex = end;
      }
    }
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) });
    out.push(toLink(match, raw));
    last = end;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

function toLink(match: RegExpExecArray, raw: string): AgentMdLink {
  if (match[1]) return { type: 'link', kind: 'moment', id: match[1], text: raw };
  if (match[2]) return { type: 'link', kind: 'chain', id: match[2], text: raw };
  if (match[3] && match[4]) return { type: 'link', kind: 'recap', id: match[3], period: match[4], text: raw };
  return { type: 'link', kind: 'http', href: raw, text: raw };
}
