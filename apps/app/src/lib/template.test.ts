import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { OFFICIAL_TEMPLATES } from '@moment/dto';
import { resolveMomentSummary, summarizePayload } from './template';
import { resolveAppIcon } from '../components/app-icon-resolve';

// resolveMomentSummary（P3-2 从 MomentCard 内联 IIFE 抽出的纯函数）：
// 链主页时刻卡的结构化摘要行——与发布兜底同一函数判重（content 逐字相同不重复显示），
// icon 取自里程碑目录（key 形态或存量 emoji 形态都可能出现，渲染层统一走 AppIcon）。
// app 测试基建是纯 node vitest，组件树断言不可行，这里钉住抽出的纯逻辑与解析层。

const baby = OFFICIAL_TEMPLATES.find((t) => t.key === 'baby')!.manifest;
const career = OFFICIAL_TEMPLATES.find((t) => t.key === 'career')!.manifest;

describe('summarizePayload 泛化（spec §5）', () => {
  it('career-event 含 catalog_key 出目录 label', () => {
    assert.equal(summarizePayload(career, 'career-event', { catalog_key: 'promotion' }), '晋升');
  });
  it('career-event 含 custom_label 出原文', () => {
    assert.equal(summarizePayload(career, 'career-event', { custom_label: '内部转组' }), '内部转组');
  });
  it('reflection 出 topic', () => {
    assert.equal(summarizePayload(career, 'reflection', { topic: '要不要接这个机会' }), '要不要接这个机会');
  });
  it('baby milestone 摘要回归不变', () => {
    assert.equal(summarizePayload(baby, 'milestone', { catalog_key: 'first-steps' }), '第一次走路');
  });
  it('metric 分支不变', () => {
    assert.equal(summarizePayload(baby, 'metric', { metric: 'height', value: 52, unit: 'cm' }), '身高 52cm');
  });
  it('未知 payload 返回空串兜底不变', () => {
    assert.equal(summarizePayload(career, 'whatever', { foo: 1 }), '');
    assert.equal(summarizePayload(career, 'standard', null), '');
  });
});

describe('resolveMomentSummary 时刻卡结构化摘要', () => {
  it('standard 时刻无摘要', () => {
    assert.equal(
      resolveMomentSummary(baby, { kind: 'standard', content: '日常', payload: { mood: '😄' } }),
      null,
    );
  });

  it('里程碑：catalog_key 命中目录，icon 为词表 key 且命中注册表', () => {
    const hit = resolveMomentSummary(baby, {
      kind: 'milestone',
      content: '',
      payload: { catalog_key: 'first-tooth' },
    });
    assert.deepEqual(hit, { icon: 'milestone-first-tooth', text: '第一颗牙' });
    assert.ok(hit && resolveAppIcon(hit.icon!), '目录 icon 必须经 resolveAppIcon 命中注册表');
  });

  it('里程碑：存量 emoji 形态 icon 原样返回，经 EMOJI_TO_ICON 映射命中注册表', () => {
    const legacy = {
      ...baby,
      milestoneCatalog: [{ key: 'first-smile', label: '第一次微笑', icon: '😊' }],
    };
    const hit = resolveMomentSummary(legacy, {
      kind: 'milestone',
      content: '',
      payload: { catalog_key: 'first-smile' },
    });
    assert.deepEqual(hit, { icon: '😊', text: '第一次微笑' });
    assert.deepEqual(hit && resolveAppIcon(hit.icon!), {
      key: 'milestone-first-smile',
      label: '第一次微笑',
    });
  });

  it('与发布兜底判重：content 与摘要逐字相同（含首尾空白）则不重复显示', () => {
    assert.equal(
      resolveMomentSummary(baby, {
        kind: 'milestone',
        content: '  第一颗牙\n',
        payload: { catalog_key: 'first-tooth' },
      }),
      null,
    );
  });

  it('metric：摘要为「身高 50cm」，无目录 icon', () => {
    const hit = resolveMomentSummary(baby, {
      kind: 'metric',
      content: '',
      payload: { metric: 'height', value: 50, unit: 'cm' },
    });
    assert.deepEqual(hit, { icon: null, text: '身高 50cm' });
  });

  it('无法摘要的 kind / 空 payload 返回 null', () => {
    assert.equal(resolveMomentSummary(baby, { kind: 'metric', content: 'x', payload: null }), null);
  });
});
