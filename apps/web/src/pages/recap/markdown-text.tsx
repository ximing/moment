import { Fragment, type ReactNode } from 'react';

// 最小安全 Markdown 渲染（spec §10 演进项——v2 可换完整 markdown 库）。
// 处理 LLM 回顾常用的子集：## / ### 标题、- 列表、**加粗**、段落。
// 不引新依赖；全部消费 tokens.css 语义 class（text-body / text-meta / font-semibold 等）。
// 不使用 raw HTML 注入——纯 React 元素，天然防 XSS。

/** 将 **text** 替换为 <strong>text</strong>（行内加粗，最简正则） */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function MarkdownText({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        // 标题
        if (lines[0]?.startsWith('### ')) {
          return <h3 key={bi} className="text-body font-semibold text-ink">{renderInline(lines[0]!.slice(4))}</h3>;
        }
        if (lines[0]?.startsWith('## ')) {
          return <h2 key={bi} className="text-page-title font-semibold text-ink">{renderInline(lines[0]!.slice(3))}</h2>;
        }
        if (lines[0]?.startsWith('# ')) {
          return <h1 key={bi} className="text-page-title font-semibold text-ink">{renderInline(lines[0]!.slice(2))}</h1>;
        }
        // 列表（- 开头的连续行）
        if (lines.every((l) => l.startsWith('- ') || l.startsWith('  '))) {
          return (
            <ul key={bi} className="flex flex-col gap-1 pl-4">
              {lines.filter((l) => l.startsWith('- ')).map((l, li) => (
                <li key={li} className="text-body text-ink list-disc">{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        // 段落
        return <p key={bi} className="whitespace-pre-wrap text-body text-ink">{renderInline(block)}</p>;
      })}
    </div>
  );
}
