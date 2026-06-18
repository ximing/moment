/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 设计体系基座契约（Task 2）：tokens.css 是颜色 / 几何 / 动效 / z-index 的唯一真相源，
// 明暗两主题都必须定义批准的语义 token；package 只暴露单一 test script；
// Vitest 在 jsdom 下加载 src/test/setup.ts。
// 注意：tsconfig.app.json 的 types 只含 vite/client，本文件用 reference 引入 node 类型；
// jsdom 环境下 import.meta.url 不是 file: 协议，路径从进程 cwd（= apps/web，与
// `pnpm --filter @moment/web test` 的执行目录一致）解析。

const webRoot = process.cwd();
const readWebFile = (relativePath: string): string =>
  readFileSync(path.resolve(webRoot, relativePath), 'utf8');

const tokensCss = readWebFile('src/styles/tokens.css');
const packageJson = JSON.parse(readWebFile('package.json')) as {
  scripts?: Record<string, string>;
};
const vitestConfig = readWebFile('vitest.config.ts');

const lightBlock = tokensCss.match(/^:root\s*\{([\s\S]*?)\n\}/m)?.[1] ?? '';
const darkBlock =
  tokensCss.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const reducedMotionBlock =
  tokensCss.match(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/,
  )?.[1] ?? '';

function propsOf(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function valueOf(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match?.[1].trim().replace(/\s+/g, ' ');
}

function missing(set: Set<string>, tokens: readonly string[]): string[] {
  return tokens.filter((token) => !set.has(token));
}

const lightProps = propsOf(lightBlock);
const darkProps = propsOf(darkBlock);

// C 端总规范 §2.1 批准的基础色彩
const BASE_TOKENS = [
  '--bg',
  '--surface',
  '--ink',
  '--muted',
  '--line',
  '--stroke',
  '--action',
  '--action-fg',
  '--select',
  '--select-fg',
  '--date',
  '--tag',
  '--focus',
  '--danger',
  '--danger-fg',
] as const;

// 链身份四色点（沿用确定性四色盘）
const CHAIN_DOT_TOKENS = [
  '--dot-pink',
  '--dot-blue',
  '--dot-mint',
  '--dot-purple',
] as const;

// Field 规范 §4.1 色彩
const FIELD_COLOR_TOKENS = [
  '--field-bg',
  '--field-bg-hover',
  '--field-bg-disabled',
  '--field-placeholder',
  '--field-focus',
  '--field-danger',
] as const;

// Modal 规范 §6 + Menu 规范 §5.1 浮层色彩
const OVERLAY_COLOR_TOKENS = [
  '--scrim',
  '--scrim-nested',
  '--overlay-shadow',
  '--floating-bg',
  '--floating-hover',
  '--floating-pressed',
  '--floating-danger-soft',
  '--floating-edge',
  '--floating-shadow',
  '--action-sheet-shadow',
  '--tooltip-bg',
  '--tooltip-fg',
] as const;

// Feedback 规范 §3.2 色彩（--feedback-toast-shadow-dark 是深色主题消费的常量，
// 只在 :root 定义一次，随下方的 ROOT_CONSTANT_TOKENS 断言）
const FEEDBACK_COLOR_TOKENS = [
  '--feedback-error-bg',
  '--feedback-warning-bg',
  '--feedback-info-bg',
  '--feedback-skeleton',
  '--feedback-toast-bg',
  '--feedback-toast-shadow',
] as const;

// 几何：布局 / 间距 / 控件 / Button / Field / Overlay / Menu / Tooltip / Feedback / 动效。
// 主题无关，只在 :root 定义一次，深色主题经层叠共享。
const GEOMETRY_TOKENS = [
  // 页面网格与壳层（C 端总规范 §2.3、§3.1）
  '--content',
  '--sidebar',
  '--rail',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-8',
  '--radius-md',
  '--radius-lg',
  // Button 规范 §5
  '--control-h',
  '--control-h-prominent',
  '--control-h-fab',
  '--button-px',
  '--button-pill-px',
  '--button-radius',
  '--button-icon-gap',
  '--icon-button-size',
  '--touch-control-min',
  '--focus-ring-w',
  '--focus-ring-offset',
  '--button-pressed-scale',
  '--button-disabled-opacity',
  // Field 规范 §4.2
  '--field-h',
  '--field-radius',
  '--field-px',
  '--field-text-size',
  '--field-label-size',
  '--field-support-size',
  '--field-label-gap',
  '--field-support-gap',
  '--field-stack-gap',
  '--field-stack-compact',
  '--textarea-min-h',
  '--field-icon-size',
  '--field-end-visual',
  '--field-end-hit',
  '--field-ring-w',
  // Modal 规范 §5
  '--dialog-w',
  '--alert-dialog-w',
  '--sheet-w',
  '--overlay-radius',
  '--sheet-mobile-radius',
  '--overlay-gap',
  '--sheet-mobile-top-gap',
  '--overlay-padding',
  '--overlay-padding-mobile',
  '--overlay-action-gap',
  // Menu 规范 §5.2 / §5.3
  '--menu-min-w',
  '--menu-max-w',
  '--menu-radius',
  '--menu-padding',
  '--menu-offset',
  '--menu-item-h',
  '--menu-item-px',
  '--menu-item-radius',
  '--menu-icon-size',
  '--menu-icon-gap',
  '--menu-viewport-gap',
  '--action-sheet-radius',
  '--action-sheet-padding',
  '--action-sheet-item-h',
  '--action-sheet-item-radius',
  '--action-sheet-cancel-gap',
  '--action-sheet-safe-bottom',
  // Menu 规范 §9 Tooltip 几何
  '--tooltip-radius',
  '--tooltip-py',
  '--tooltip-px',
  '--tooltip-text-size',
  // Feedback 规范 §4.2 / §5.2 / §6.3 / §7.3 / §8.2
  '--banner-radius',
  '--banner-py',
  '--banner-px',
  '--banner-gap',
  '--banner-icon-size',
  '--toast-min-h',
  '--toast-radius',
  '--toast-px',
  '--toast-max-w',
  '--toast-gap',
  '--empty-max-w',
  '--empty-page-py',
  '--empty-page-py-mobile',
  '--empty-section-py',
  '--empty-title-size',
  '--empty-title-lh',
  '--empty-body-size',
  '--empty-body-lh',
  '--empty-action-gap',
  '--skeleton-delay',
  '--skeleton-min-visible',
  '--skeleton-cycle',
  '--inline-progress-min-h',
  '--inline-progress-spinner',
  '--inline-progress-track-h',
  '--inline-progress-radius',
  // 动效（C 端总规范 §8）
  '--ease',
  '--ease-out',
  '--ease-in',
] as const;

// Modal 规范 §4 + Menu 规范 §10 + Feedback 规范 §3.2 层级
const Z_INDEX_TOKENS = [
  '--z-floating',
  '--z-overlay',
  '--z-overlay-popover',
  '--z-overlay-floating',
  '--z-tooltip',
  '--z-toast',
  '--z-overlay-nested',
  '--z-lightbox',
] as const;

// 旧视觉体系的过渡 alias：只服务既有调用方，Task 13 统一清理，不得新增。
const LEGACY_TRANSITION_ALIASES = [
  '--today',
  '--knot-yesterday',
  '--knot-older',
  '--date-sticker-bg',
  '--date-sticker-line',
  '--date-sticker-fg',
  '--sticker-pink',
  '--sticker-blue',
  '--sticker-mint',
  '--sticker-purple',
  '--sticker-pink-line',
  '--sticker-blue-line',
  '--sticker-mint-line',
  '--sticker-purple-line',
  '--dot-gold',
  '--shadow',
  '--elev',
  '--elev-sm',
  '--control-h-sm',
  '--radius-sm',
] as const;

const THEMED_TOKENS = [
  ...BASE_TOKENS,
  ...CHAIN_DOT_TOKENS,
  ...FIELD_COLOR_TOKENS,
  ...OVERLAY_COLOR_TOKENS,
  ...FEEDBACK_COLOR_TOKENS,
] as const;

// C 端总规范 §2.1 批准值：浅色
const LIGHT_BASE_VALUES: Record<string, string> = {
  '--bg': '#f6f1ec',
  '--surface': '#fffdfb',
  '--ink': '#2b201c',
  '--muted': '#6f5d54',
  '--line': '#d8c9c0',
  '--stroke': '#b79989',
  '--action': '#c94a3a',
  '--action-fg': '#fffdfb',
  '--select': '#f2b84b',
  '--select-fg': '#2b201c',
  '--date': '#ded4ff',
  '--tag': '#4b7562',
  '--focus': '#7656d8',
  '--danger': '#b83a30',
  '--danger-fg': '#fffdfb',
};

// C 端总规范 §2.1 批准值：深色
const DARK_BASE_VALUES: Record<string, string> = {
  '--bg': '#171412',
  '--surface': '#26211e',
  '--ink': '#f7efe9',
  '--muted': '#c3b5ad',
  '--line': '#463c37',
  '--stroke': '#76675f',
  '--action': '#ff755e',
  '--action-fg': '#241714',
  '--select': '#f2b84b',
  '--select-fg': '#2b201c',
  '--date': '#433b5e',
  '--tag': '#87c2a5',
  '--focus': '#b59cff',
  '--danger': '#ff8a72',
  '--danger-fg': '#2b201c',
};

const LIGHT_STATE_VALUES: Record<string, string> = {
  '--field-bg': '#f0e9e4',
  '--field-bg-hover': '#ebe2dc',
  '--field-bg-disabled': '#f3eeea',
  '--scrim': 'rgb(43 32 28 / 36%)',
  '--scrim-nested': 'rgb(43 32 28 / 22%)',
  '--overlay-shadow': '0 24px 64px rgb(43 32 28 / 24%)',
};

const DARK_STATE_VALUES: Record<string, string> = {
  '--field-bg': '#1f1a17',
  '--field-bg-hover': '#231d1a',
  '--field-bg-disabled': '#201c19',
  '--scrim': 'rgb(0 0 0 / 58%)',
  '--scrim-nested': 'rgb(0 0 0 / 36%)',
  '--overlay-shadow': '0 24px 64px rgb(0 0 0 / 48%)',
};

const Z_INDEX_VALUES: Record<string, string> = {
  '--z-floating': '50',
  '--z-overlay': '60',
  '--z-overlay-popover': '61',
  '--z-overlay-floating': '61',
  '--z-tooltip': '62',
  '--z-toast': '65',
  '--z-overlay-nested': '70',
  '--z-lightbox': '80',
};

const KEY_GEOMETRY_VALUES: Record<string, string> = {
  '--content': '760px',
  '--sidebar': '208px',
  '--rail': '184px',
  '--control-h': '40px',
  '--control-h-prominent': '44px',
  '--button-radius': '11px',
  '--touch-control-min': '44px',
  '--focus-ring-w': '2px',
  '--focus-ring-offset': '2px',
  '--field-h': '44px',
  '--field-radius': '13px',
  '--textarea-min-h': '112px',
  '--dialog-w': '480px',
  '--alert-dialog-w': '400px',
  '--sheet-w': '520px',
  '--overlay-radius': '24px',
  '--menu-item-h': '42px',
  '--action-sheet-item-h': '48px',
  '--toast-min-h': '48px',
};

describe('tokens.css 主题契约', () => {
  it('浅色主题定义全部批准的 base / field / overlay / feedback / 链色 token', () => {
    expect(missing(lightProps, THEMED_TOKENS)).toEqual([]);
  });

  it('深色主题定义全部批准的 base / field / overlay / feedback / 链色 token', () => {
    expect(darkBlock).not.toBe('');
    expect(missing(darkProps, THEMED_TOKENS)).toEqual([]);
  });

  it('定义全部几何 token（两主题共享 :root）', () => {
    expect(missing(lightProps, GEOMETRY_TOKENS)).toEqual([]);
  });

  it('定义全部 z-index token', () => {
    expect(missing(lightProps, Z_INDEX_TOKENS)).toEqual([]);
  });

  it('基础色彩取规范批准值（浅色）', () => {
    for (const [token, value] of Object.entries(LIGHT_BASE_VALUES)) {
      expect(valueOf(lightBlock, token), token).toBe(value);
    }
  });

  it('基础色彩取规范批准值（深色）', () => {
    for (const [token, value] of Object.entries(DARK_BASE_VALUES)) {
      expect(valueOf(darkBlock, token), token).toBe(value);
    }
  });

  it('Field 色面与 Overlay 遮罩 / 阴影取规范批准值（浅色）', () => {
    for (const [token, value] of Object.entries(LIGHT_STATE_VALUES)) {
      expect(valueOf(lightBlock, token), token).toBe(value);
    }
  });

  it('Field 色面与 Overlay 遮罩 / 阴影取规范批准值（深色）', () => {
    for (const [token, value] of Object.entries(DARK_STATE_VALUES)) {
      expect(valueOf(darkBlock, token), token).toBe(value);
    }
  });

  it('z-index 层级取规范批准值', () => {
    for (const [token, value] of Object.entries(Z_INDEX_VALUES)) {
      expect(valueOf(lightBlock, token), token).toBe(value);
    }
  });

  it('关键几何取规范批准值', () => {
    for (const [token, value] of Object.entries(KEY_GEOMETRY_VALUES)) {
      expect(valueOf(lightBlock, token), token).toBe(value);
    }
  });

  it('prefers-reduced-motion 下动效降至近零', () => {
    expect(reducedMotionBlock).not.toBe('');
    for (const token of ['--ease', '--ease-out', '--ease-in']) {
      expect(valueOf(reducedMotionBlock, token), token).toBe('1ms linear');
    }
  });

  it('保留既有调用方需要的文档化过渡 alias（Task 13 清理）', () => {
    expect(missing(lightProps, LEGACY_TRANSITION_ALIASES)).toEqual([]);
  });

  it('深色 Toast 阴影常量在 :root 定义并被深色主题消费', () => {
    expect(valueOf(lightBlock, '--feedback-toast-shadow-dark')).toBe(
      '0 16px 40px rgb(0 0 0 / 42%)',
    );
    expect(valueOf(darkBlock, '--feedback-toast-shadow')).toBe(
      'var(--feedback-toast-shadow-dark)',
    );
  });
});

describe('Web 测试脚本契约', () => {
  it('package 暴露单一 test script 运行 Vitest', () => {
    const scripts = packageJson.scripts ?? {};
    expect(scripts.test).toBe('vitest run');
    expect(
      Object.keys(scripts).filter((key) => key === 'test' || key.startsWith('test:')),
    ).toEqual(['test']);
  });

  it('package 暴露 design-system 视觉回归命令', () => {
    expect(packageJson.scripts?.['e2e:design-system']).toBe(
      'node e2e/run.mjs design-system-regression',
    );
  });

  it('Vitest 在 jsdom 下加载 src/test/setup.ts', () => {
    expect(vitestConfig).toContain('vitest/config');
    expect(vitestConfig).toContain('jsdom');
    expect(vitestConfig).toContain('src/test/setup.ts');
  });
});
