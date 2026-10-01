import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

// 对话自己的 Markdown 子集（agent dock spec §0.1 / §6）。
// 不复用回顾页 MarkdownText，避免回顾页回归。不注入 HTML。

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const URL_TAIL = /[.,;:!?，。、；：！？)）\]】》」』]+$/u;

const LINK_CLASS =
  'inline text-left text-action underline rounded-button focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset';

type Block =
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string };

function headingOf(line: string): { level: 1 | 2 | 3; text: string } | null {
  if (line.startsWith('### ')) return { level: 3, text: line.slice(4) };
  if (line.startsWith('## ')) return { level: 2, text: line.slice(3) };
  if (line.startsWith('# ')) return { level: 1, text: line.slice(2) };
  return null;
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const heading = headingOf(line);
    if (heading) {
      blocks.push({ type: 'h', level: heading.level, text: heading.text });
      index += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('- ')) {
        items.push((lines[index] ?? '').slice(2));
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\. /.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\d+\. /, ''));
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        current.trim() === '' ||
        headingOf(current) ||
        current.startsWith('- ') ||
        /^\d+\. /.test(current)
      ) {
        break;
      }
      para.push(current);
      index += 1;
    }
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

function inlinePattern(): RegExp {
  return new RegExp(
    [
      '\\*\\*[^*]+\\*\\*',
      '`[^`]+`',
      `moment:${UUID}`,
      `chain:${UUID}`,
      `recap:${UUID}/\\d{4}-\\d{2}`,
      'https?:\\/\\/[^\\s<>]+',
    ].join('|'),
    'g',
  );
}

function pathForToken(token: string): string | null {
  const moment = new RegExp(`^moment:(${UUID})$`).exec(token);
  if (moment?.[1]) return `/moments/${moment[1]}`;
  const chain = new RegExp(`^chain:(${UUID})$`).exec(token);
  if (chain?.[1]) return `/chains/${chain[1]}`;
  const recap = new RegExp(`^recap:(${UUID})/(\\d{4}-\\d{2})$`).exec(token);
  if (recap?.[1] && recap[2]) return `/chains/${recap[1]}/recaps/${recap[2]}`;
  return null;
}

function renderInline(text: string, onNavigate: (path: string) => void, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = inlinePattern();
  let last = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const token = match[0];
    if (!token) break;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${count}`;
    count += 1;
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {renderInline(token.slice(2, -2), onNavigate, key)}
        </strong>,
      );
    } else if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      nodes.push(
        <code key={key} className="rounded-button bg-bg px-1 text-meta">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('moment:') || token.startsWith('chain:') || token.startsWith('recap:')) {
      const path = pathForToken(token);
      if (!path) nodes.push(token);
      else {
        nodes.push(
          <button key={key} type="button" className={LINK_CLASS} onClick={() => onNavigate(path)}>
            {token}
          </button>,
        );
      }
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      const href = token.replace(URL_TAIL, '');
      const rest = token.slice(href.length);
      if (href.startsWith('http://') || href.startsWith('https://')) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            {href}
          </a>,
        );
        if (rest) nodes.push(rest);
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'text-page-title font-semibold text-ink',
  2: 'text-body font-semibold text-ink',
  3: 'text-meta font-semibold text-ink',
};

/** 助手正文。内部链接走应用内路由；http/https 新开页；javascript: 与 moment:// 保持字面量。 */
export function AgentMarkdown({ content }: { content: string }) {
  const navigate = useNavigate();
  const blocks = parseBlocks(content);
  const open = (path: string) => navigate(path);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        if (block.type === 'h') {
          const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return (
            <Heading key={key} className={HEADING_CLASS[block.level]}>
              {renderInline(block.text, open, key)}
            </Heading>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          const List = block.type === 'ul' ? 'ul' : 'ol';
          const marker = block.type === 'ul' ? 'list-disc' : 'list-decimal';
          return (
            <List key={key} className={`flex flex-col gap-1 pl-4 ${marker}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`} className="text-body text-ink">
                  {renderInline(item, open, `${key}-${itemIndex}`)}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap text-body text-ink">
            {renderInline(block.text, open, key)}
          </p>
        );
      })}
    </div>
  );
}

