import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { OFFICIAL_TEMPLATES, REACTION_EMOJIS } from '@moment/dto';
import { resolveAppIcon } from './app-icon-resolve';

describe('resolveAppIcon 三级解析', () => {
  it('命中注册表', () => {
    assert.deepEqual(resolveAppIcon('milestone-first-tooth'), { key: 'milestone-first-tooth', label: '第一颗牙' });
  });
  it('命中 EMOJI_TO_ICON 映射', () => {
    assert.deepEqual(resolveAppIcon('😴'), { key: 'mood-sleepy', label: '困倦' });
  });
  it('🥰 映射到 mood-love（别名决策）', () => {
    assert.deepEqual(resolveAppIcon('🥰'), { key: 'mood-love', label: '幸福' });
  });
  it('自由 emoji（含 ZWJ/肤色）与未知值落兜底', () => {
    assert.equal(resolveAppIcon('👨‍👩‍👧'), null);
    assert.equal(resolveAppIcon('👍🏽'), null);
    assert.equal(resolveAppIcon('whatever'), null);
  });
});

// P3-2 替换点值覆盖：moment 详情 reaction 条 / MomentCard 心情行 / compose mood chips /
// moodline 等处的数据值全部改经 <AppIcon value> 渲染。app 测试基建是纯 node vitest，
// 组件树渲染断言不可行，这里钉住解析层——替换点用到的封闭词表值必须全部命中注册表
// （命中即渲染 svg），词表外的自由值落兜底 null（AppIcon 按原文本渲染，视觉不变）。
describe('P3-2 替换点数据值 → AppIcon 解析', () => {
  it('reaction 白名单 10 值全部命中注册表（❤️ → reaction-love）', () => {
    const expected: Record<string, string> = {
      '👍': 'reaction-like',
      '❤️': 'reaction-love',
      '😂': 'reaction-laugh',
      '😮': 'reaction-wow',
      '😢': 'reaction-sad',
      '🎉': 'reaction-celebrate',
      // spec §3.1 既定别名决策：🥰 念「幸福」（mood-love），不建 reaction 平行映射
      '🥰': 'mood-love',
      '👏': 'reaction-clap',
      '💪': 'reaction-strong',
      '🙏': 'reaction-thanks',
    };
    assert.equal(REACTION_EMOJIS.length, 10);
    for (const emoji of REACTION_EMOJIS) {
      assert.equal(resolveAppIcon(emoji)?.key, expected[emoji], `${emoji} 应命中 ${expected[emoji]}`);
    }
  });

  it('daily 模板 mood 5 值全部命中 mood-*（取自 OFFICIAL_TEMPLATES 词表本身）', () => {
    const daily = OFFICIAL_TEMPLATES.find((t) => t.key === 'daily')!.manifest;
    const moodField = (daily.momentFields ?? []).find((f) => f.key === 'mood')!;
    assert.equal(moodField.type, 'emoji-picker');
    const expected: Record<string, string> = {
      '😄': 'mood-joy',
      '🥰': 'mood-love',
      '😭': 'mood-cry',
      '😤': 'mood-angry',
      '😴': 'mood-sleepy',
    };
    assert.deepEqual(moodField.options, Object.keys(expected));
    for (const opt of moodField.options ?? []) {
      assert.equal(resolveAppIcon(opt)?.key, expected[opt], `${opt} 应命中 ${expected[opt]}`);
    }
  });

  it('里程碑目录 icon（key 形态与存量 emoji 形态）全部命中注册表', () => {
    const baby = OFFICIAL_TEMPLATES.find((t) => t.key === 'baby')!.manifest;
    for (const c of baby.milestoneCatalog ?? []) {
      assert.ok(c.icon && resolveAppIcon(c.icon), `${c.key} 的 icon ${c.icon} 应命中注册表`);
    }
    // 存量 emoji 形态（EMOJI_TO_ICON baby 里程碑段）：旧数据 / 旧 manifest 缓存仍可能带 emoji
    for (const emoji of ['😊', '🔄', '🪑', '🐾', '🧍', '👣', '💬', '🦷']) {
      assert.ok(resolveAppIcon(emoji)?.key.startsWith('milestone-'), `${emoji} 应映射到 milestone-*`);
    }
  });
});
