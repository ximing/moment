/** 存量封闭 emoji 词表 → icon key。数据继续存 emoji，仅渲染层映射（spec §3.1）。 */
export const EMOJI_TO_ICON: Readonly<Record<string, string>> = {
  // daily 模板 mood（5）
  '😄': 'mood-joy',
  '🥰': 'mood-love',
  '😭': 'mood-cry',
  '😤': 'mood-angry',
  '😴': 'mood-sleepy',
  // reaction 白名单（REACTION_EMOJIS 共 10 项；🥰 已在上方 mood 区映射，此处不重复列——
  // 🥰 冲突决策：reaction-sweet 在注册表中是 mood-love 的别名，EMOJI_TO_ICON['🥰'] = 'mood-love'，见 spec §3.1）
  '👍': 'reaction-like',
  '❤️': 'reaction-love',
  '😂': 'reaction-laugh',
  '😮': 'reaction-wow',
  '😢': 'reaction-sad',
  '🎉': 'reaction-celebrate',
  '👏': 'reaction-clap',
  '💪': 'reaction-strong',
  '🙏': 'reaction-thanks',
  // baby 里程碑目录（8）
  '😊': 'milestone-first-smile',
  '🔄': 'milestone-first-roll',
  '🪑': 'milestone-first-sit',
  '🐾': 'milestone-first-crawl',
  '🧍': 'milestone-first-stand',
  '👣': 'milestone-first-steps',
  '💬': 'milestone-first-word',
  '🦷': 'milestone-first-tooth',
  // 旧官方模板 icon（3，防御性兼容：seed 会改写 DB，但客户端可能持有旧 manifest 缓存）
  '👶': 'tpl-baby',
  '✈️': 'tpl-travel',
  '🏠': 'tpl-daily',
};
