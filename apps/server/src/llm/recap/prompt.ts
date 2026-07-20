import type { RecapInput } from './input.js';

/** prompt 模板版本（重生成对比用，spec §2 prompt_version）。 */
export const PROMPT_VERSION = 1;

/**
 * System prompt（spec §4.5）：要求 LLM 返回严格 JSON。
 * ```json
 * { "content": "<markdown 正文>", "highlight_moment_ids": ["<moment uuid>", ...] }
 * ```
 * highlight_moment_ids 类型为 string[]（moments.id 是 char36 UUID，非 number[]——spec §4 笔误修正）。
 */
export function buildSystemPrompt(): string {
  return `你是一个家庭时光链的月度回顾撰写助手。根据提供的时刻记录与评论，撰写一份温暖、有情感的 Markdown 月度回顾。

输出要求：
1. 仅返回一个 JSON 对象，不要包含任何解释文字、markdown 代码块包裹或注释。
2. JSON 结构：
   {
     "content": "<string: Markdown 正文，含标题与小节>",
     "highlight_moment_ids": ["<string: 引用的高光 moment 的 id>", ...]
   }
3. content 用 Markdown 写作，结构清晰（标题、段落、列表），体现本月的情感脉络与成长。
4. highlight_moment_ids 必须从输入的 moment 列表中选择（每个 id 是 char(36) UUID 字符串，类型为 string[]，不是数字），选出最值得作为「高光时刻」的 1-5 条。
5. 不要编造输入中不存在的 moment id。
6. 不要在 content 中泄露任何 PII（邮箱等），只使用提供的昵称。
7. 回顾语气贴近中国家庭，温暖、具体、不空洞。`;
}

/**
 * User prompt（spec §4）：把 RecapInput 序列化为 LLM 可读文本。
 * 每条 moment 含 line（[MM-DD HH:mm] 昵称 + 正文 + payload 摘要）+ 评论 + momentId。
 */
export function buildUserPrompt(input: RecapInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.chainName} 的 ${input.period} 月度回顾`);
  if (input.babyAge) {
    lines.push(`宝宝月龄：本期末 ${input.babyAge}`);
  }
  lines.push('');
  lines.push(`本月共记录 ${input.truncated.count} 条时刻${input.truncated.moments || input.truncated.chars ? '（已截断，仅展示部分）' : ''}。`);
  lines.push('');

  if (input.moments.length === 0) {
    lines.push('本月无记录。请基于此生成一段简短回顾，说明本月暂无记录。');
    return lines.join('\n');
  }

  lines.push('## 时刻列表');
  for (const m of input.moments) {
    lines.push(`- [momentId: ${m.momentId}] ${m.line}`);
    if (m.comments.length > 0) {
      for (const c of m.comments) {
        lines.push(`  - 评论：${c}`);
      }
    }
  }
  lines.push('');
  lines.push('请基于以上时刻撰写月度回顾，并选出 1-5 条高光 moment 的 id 填入 highlight_moment_ids。');
  return lines.join('\n');
}
