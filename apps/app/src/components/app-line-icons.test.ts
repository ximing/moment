import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { APP_LINE_ICONS, type AppLineIconNode } from './app-line-icons';

// P4-2 装饰 emoji 清扫词表：app 端写死装饰字符 → 单色线性 Icon 所需全部名字
// （Tab 栏 🏠⛓️🔔👤 + 📍📅💬⚙️ 各替换点）。词表只增不减。
const REQUIRED_NAMES = [
  'house',
  'link-2',
  'bell',
  'user',
  'map-pin',
  'settings',
  'calendar',
  'message-circle',
  'plus',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'search',
  'check',
  'ellipsis',
  'image',
  'mic',
  'video',
  'type',
  'x',
  'download',
] as const;

const KNOWN_TAGS = new Set(['path', 'circle', 'line', 'rect']);

describe('APP_LINE_ICONS 词表', () => {
  it('覆盖装饰 emoji 清扫所需全部名字', () => {
    for (const name of REQUIRED_NAMES) {
      assert.ok(name in APP_LINE_ICONS, `缺少 ${name}`);
      assert.ok(APP_LINE_ICONS[name].length > 0, `${name} 图元为空`);
    }
  });

  it('每个图元是已知节点类型且带关键属性（lucide iconNode 同构）', () => {
    for (const [name, nodes] of Object.entries(APP_LINE_ICONS)) {
      for (const node of nodes as readonly AppLineIconNode[]) {
        assert.ok(KNOWN_TAGS.has(node[0]), `${name} 含未知图元 ${node[0]}`);
        if (node[0] === 'path') assert.ok(node[1].d.length > 0, `${name} path d 为空`);
      }
    }
  });
});
