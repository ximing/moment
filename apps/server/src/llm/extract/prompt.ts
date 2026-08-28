/**
 * AI 文本抽取 prompt（spec people-place §5）。
 * 输入素材：moment 正文 content + 语音转写 transcript（voice 时刻正文常空，transcript 是主素材）。
 * 输出契约：严格 JSON `{ "persons": string[], "places": string[] }`。
 * 成本护栏（spec §5）：content 与 transcript 各截断前 2000 字符，超长时在 prompt 内声明截断。
 */

/** 单段素材截断上限（spec §5 成本护栏：content+transcript 各取前 2000 字符）。 */
export const EXTRACT_MAX_INPUT_CHARS = 2000;

export function buildExtractSystemPrompt(): string {
  return `你是家庭时光链的元数据抽取助手。从一条时刻记录（正文与语音转写文本）中抽取「人物」与「地点」。

输出要求：
1. 仅返回一个 JSON 对象，不要包含任何解释文字、markdown 代码块包裹或注释。
2. JSON 结构：
   {
     "persons": ["<string: 人物名>", ...],
     "places": ["<string: 地名或场所短语>", ...]
   }
3. 人物规则：抽取人名与亲属称谓，原样保留文本写法（如「外婆」「朵朵」「王叔叔」）；不抽取第一人称与第二人称（「我」「你」「咱们」等）；没有人物时 persons 为空数组 []。
4. 地点规则：抽取地名与场所短语，原样保留文本写法（如「外婆家」「朝阳公园」「北京」）；不要臆造或补全坐标、门牌等文本中不存在的细节；没有地点时 places 为空数组 []。
5. 只从给定文本抽取，不要编造文本中未出现的人物或地点。
6. 输出语言与输入一致。`;
}

/**
 * User prompt（spec §5）：正文与语音转写两段素材，各截断到 EXTRACT_MAX_INPUT_CHARS，
 * 超长时声明截断（spec §5「prompt 内声明截断」，不静默截断）。
 */
export function buildExtractUserPrompt(content: string, transcript: string | null): string {
  const contentSlice = content.slice(0, EXTRACT_MAX_INPUT_CHARS);
  const transcriptSlice = (transcript ?? '').slice(0, EXTRACT_MAX_INPUT_CHARS);

  const lines: string[] = [];
  lines.push('# 时刻记录');
  lines.push('');
  lines.push('## 正文');
  lines.push(contentSlice.length === 0 ? '（无正文）' : contentSlice);
  if (content.length > contentSlice.length) {
    lines.push(`（正文超长，已截断为前 ${EXTRACT_MAX_INPUT_CHARS} 字符）`);
  }
  lines.push('');
  lines.push('## 语音转写');
  if (transcript === null) {
    lines.push('（无语音转写）');
  } else if (transcriptSlice.length === 0) {
    lines.push('（语音转写为空）');
  } else {
    lines.push(transcriptSlice);
    if (transcript.length > transcriptSlice.length) {
      lines.push(`（语音转写超长，已截断为前 ${EXTRACT_MAX_INPUT_CHARS} 字符）`);
    }
  }
  lines.push('');
  lines.push('请从以上时刻记录中抽取人物与地点，按系统要求的 JSON 结构返回。');
  return lines.join('\n');
}
