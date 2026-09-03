export interface IconManifestEntry {
  /** svg/ 下的文件名（含扩展名） */
  file: string;
  /** 中文标签，用于无障碍文本（aria-label / accessibilityLabel）与表情含义展示 */
  label: string;
  /** 色彩基调 hint：供绘制与视觉走查参考，不影响运行时渲染 */
  tone: 'amber' | 'rose' | 'sky' | 'green' | 'purple' | 'neutral';
}

export const ICON_MANIFEST = {
  'mood-joy': { file: 'mood-joy.svg', label: '开心', tone: 'amber' },
  'mood-love': { file: 'mood-love.svg', label: '幸福', tone: 'rose' },
  'mood-cry': { file: 'mood-cry.svg', label: '难过', tone: 'sky' },
  'mood-angry': { file: 'mood-angry.svg', label: '烦躁', tone: 'rose' },
  'mood-sleepy': { file: 'mood-sleepy.svg', label: '困倦', tone: 'purple' },
  'reaction-like': { file: 'reaction-like.svg', label: '点赞', tone: 'sky' },
  'reaction-love': { file: 'reaction-love.svg', label: '爱心', tone: 'rose' },
  'reaction-laugh': { file: 'reaction-laugh.svg', label: '笑哭', tone: 'amber' },
  'reaction-wow': { file: 'reaction-wow.svg', label: '惊讶', tone: 'amber' },
  'reaction-sad': { file: 'reaction-sad.svg', label: '难过', tone: 'sky' },
  'reaction-celebrate': { file: 'reaction-celebrate.svg', label: '庆祝', tone: 'purple' },
  // reaction-sweet 是 mood-love 的别名：🥰 同存于 mood 与 reaction 词表，映射表是纯函数无法按场景分叉（spec §3.1）
  'reaction-sweet': { file: 'mood-love.svg', label: '喜爱', tone: 'rose' },
  'reaction-clap': { file: 'reaction-clap.svg', label: '鼓掌', tone: 'amber' },
  'reaction-strong': { file: 'reaction-strong.svg', label: '加油', tone: 'green' },
  'reaction-thanks': { file: 'reaction-thanks.svg', label: '感谢', tone: 'amber' },
  'rating-love': { file: 'rating-love.svg', label: '超爱', tone: 'rose' },
  'rating-good': { file: 'rating-good.svg', label: '推荐', tone: 'amber' },
  'rating-ok': { file: 'rating-ok.svg', label: '一般', tone: 'neutral' },
  'rating-pass': { file: 'rating-pass.svg', label: '不推荐', tone: 'sky' },
  'milestone-first-smile': { file: 'milestone-first-smile.svg', label: '第一次微笑', tone: 'amber' },
  'milestone-first-roll': { file: 'milestone-first-roll.svg', label: '第一次翻身', tone: 'green' },
  'milestone-first-sit': { file: 'milestone-first-sit.svg', label: '第一次独坐', tone: 'sky' },
  'milestone-first-crawl': { file: 'milestone-first-crawl.svg', label: '第一次爬', tone: 'green' },
  'milestone-first-stand': { file: 'milestone-first-stand.svg', label: '第一次站立', tone: 'purple' },
  'milestone-first-steps': { file: 'milestone-first-steps.svg', label: '第一次走路', tone: 'amber' },
  'milestone-first-word': { file: 'milestone-first-word.svg', label: '第一次开口', tone: 'sky' },
  'milestone-first-tooth': { file: 'milestone-first-tooth.svg', label: '第一颗牙', tone: 'neutral' },
  'tpl-baby': { file: 'tpl-baby.svg', label: '宝宝成长', tone: 'rose' },
  'tpl-travel': { file: 'tpl-travel.svg', label: '旅行', tone: 'sky' },
  'tpl-daily': { file: 'tpl-daily.svg', label: '日常生活', tone: 'amber' },
  'tpl-reading': { file: 'tpl-reading.svg', label: '读书笔记', tone: 'green' },
  'tpl-career': { file: 'tpl-career.svg', label: '职业生涯', tone: 'purple' },
} as const satisfies Record<string, IconManifestEntry>;

export type IconKey = keyof typeof ICON_MANIFEST;

export function hasIconKey(value: string): value is IconKey {
  return Object.prototype.hasOwnProperty.call(ICON_MANIFEST, value);
}
