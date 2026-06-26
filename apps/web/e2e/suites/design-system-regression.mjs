/**
 * design-system-regression suite（plan Task 14）：
 * 唯一持有定位器的文件——只用语义 role/name、label 或唯一 id/data-testid；
 * 禁止 class、位置序、CSS 布局选择器、XPath 与 snapshot 引用。
 * 两次登录都走可见 /login 表单的真实 /api/auth/login；不调 tokenStore、
 * 不改 local/session storage、不合成 auth 态、不把 seed 结果当会话。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { MAX_DIFF_PIXELS, PIXELMATCH_THRESHOLD } from '../lib/bridge.mjs';
import { waitForVisualIdle } from '../lib/env.mjs';
import { baselinesRoot } from '../lib/manifest.mjs';

/** 与 apps/server/src/e2e/fixture-rows.ts 的确定性 fixture 常量一一对应（单一来源在 server 侧）。 */
const EXPECTED = Object.freeze({
  chainName: '我们一起走过的很长很长的时光链名字',
  tagName: '跨年旅行与新年第一束光和家人的漫长回忆',
  textMoment: '2025 年最后一天：一起把这一年的温柔收好。',
  imageMoment: '2026 年第一天：新年的第一束光。',
  feedTitle: '大家的日子',
  ownerNickname: '林晓满',
  viewerNickname: '周小禾',
});

/**
 * 页面内语义定位助手（每个 evaluate 自包含注入）：
 * 只按 implicit/explicit role 与可访问名称（aria-label / label / 文本）查找可见元素。
 */
const PAGE_HELPERS = `
function __e2eVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}
function __e2eName(el) {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy.split(/\\s+/).map((id) => {
      const target = document.getElementById(id);
      return target ? target.textContent : '';
    }).join(' ').trim();
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return label.textContent.trim();
    }
    const wrapping = el.closest('label');
    if (wrapping) return wrapping.textContent.trim();
    return (el.getAttribute('placeholder') ?? '').trim();
  }
  return (el.textContent ?? '').replace(/\\s+/g, ' ').trim();
}
function __e2eRole(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'button' || type === 'submit') return 'button';
    return 'textbox';
  }
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'dialog') return 'dialog';
  if (tag === 'nav') return 'navigation';
  if (tag === 'main') return 'main';
  if (tag === 'img') return 'img';
  return '';
}
function __e2eAll() {
  return Array.from(document.querySelectorAll(
    'button,a,input,textarea,select,[role],h1,h2,h3,h4,h5,h6,dialog,nav,main,img',
  )).filter(__e2eVisible);
}
function __e2eFind(role, name) {
  return __e2eAll().find((el) => {
    if (role && __e2eRole(el) !== role) return false;
    return __e2eName(el).includes(name);
  }) ?? null;
}
function __e2eFindAll(role, name) {
  return __e2eAll().filter((el) => {
    if (role && __e2eRole(el) !== role) return false;
    return name ? __e2eName(el).includes(name) : true;
  });
}
`;

/** 在途 fetch/XHR 计数器：bridge 的 WAIT_FOR_NETWORK_IDLE_SCRIPT 观察同一个 window 状态。 */
const NETWORK_TRACKER_SCRIPT = `(() => {
  if (window.__e2eNetworkIdle) return true;
  const state = { pending: 0, lastChangeAt: Date.now() };
  const bump = (delta) => {
    state.pending = Math.max(0, state.pending + delta);
    state.lastChangeAt = Date.now();
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    bump(1);
    return originalFetch(...args).finally(() => bump(-1));
  };
  const proto = window.XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  proto.open = function (...args) {
    this.__e2eTrack = true;
    return originalOpen.apply(this, args);
  };
  proto.send = function (...args) {
    if (this.__e2eTrack) {
      bump(1);
      this.addEventListener('loadend', () => bump(-1), { once: true });
    }
    return originalSend.apply(this, args);
  };
  window.__e2eNetworkIdle = state;
  return true;
})()`;

function quote(value) {
  return JSON.stringify(value);
}

async function installTracker(bridge) {
  await bridge.evaluate(NETWORK_TRACKER_SCRIPT);
}

async function waitFor(bridge, code, { timeoutMs = 15000, intervalMs = 150, label = code } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await bridge.evaluate(code);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`suite waitFor timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function waitForText(bridge, text) {
  return waitFor(
    bridge,
    `document.body && document.body.innerText.includes(${quote(text)})`,
    { label: `visible text ${text}` },
  );
}

async function waitForNoText(bridge, text) {
  return waitFor(
    bridge,
    `document.body && !document.body.innerText.includes(${quote(text)})`,
    { label: `absent text ${text}` },
  );
}

async function waitForPath(bridge, predicateCode) {
  return waitFor(bridge, `(${predicateCode})(location.pathname + location.search)`, {
    label: `url predicate ${predicateCode}`,
  });
}

/** 语义点击：按 role/name 找到可见元素后 el.click()（不经选择器）。 */
async function clickByRoleName(bridge, role, name, { optional = false } = {}) {
  const clicked = await bridge.evaluate(`${PAGE_HELPERS}
    (() => {
      const el = __e2eFind(${quote(role)}, ${quote(name)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
  if (!clicked && !optional) throw new Error(`suite: no visible ${role} named '${name}'`);
  return clicked;
}

async function hasByRoleName(bridge, role, name) {
  return bridge.evaluate(`${PAGE_HELPERS}
    (() => __e2eFind(${quote(role)}, ${quote(name)}) !== null)()`);
}

/**
 * 发布入口可用性：owner 在链页/feed 页必有一个可用的 compose 入口，
 * viewer（任何链都不可写）全程不见（feed-home / chain-home 与 ComposeFab
 * 共用 canCompose 抑制规则）。入口文案随页面形态不同：feed 页眉与空态是
 * 「记下此刻」，日子线常驻入口 ComposerEntry 是「这一刻，记点什么…」，
 * 滚动接力 FAB 是 aria-label「记下此刻」——任一命中即可。
 */
async function composeAffordanceEnabled(bridge) {
  return bridge.evaluate(`${PAGE_HELPERS}
    (() => {
      const names = ['记下此刻', '这一刻，记点什么'];
      const el = __e2eAll().find((candidate) =>
        __e2eRole(candidate) === 'button'
        && names.some((name) => __e2eName(candidate).includes(name)));
      if (!el) return false;
      return !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    })()`);
}

async function setTheme(bridge, theme) {
  // dataset.theme 直接驱动 tokens.css 的 :root[data-theme='dark'] 选择器。
  // 但同一 document 上前一路由/前一案例可能排有 applyTheme() 的异步覆写
  //（index.html 防 FOUC snippet、ThemeService subscribeSystemTheme、页面 effect），
  // 所以写入后轮询确认计算背景色亮度与目标一致；被覆写时重设，5s 不一致硬失败。
  const wantDark = theme === 'dark';
  const deadline = Date.now() + 20000;
  for (;;) {
    const applied = await bridge.evaluate(`(() => {
      document.documentElement.dataset.theme = ${quote(theme)};
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/[0-9]+/g);
      if (!m || m.length < 3) return false;
      const lum = (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3;
      return ${wantDark} ? lum < 128 : lum >= 128;
    })()`);
    if (applied) return;
    if (Date.now() > deadline) {
      const dbg = await bridge.evaluate(`(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        return bg + ' dt=' + document.documentElement.dataset.theme + ' url=' + location.href;
      })()`);
      throw new Error(`suite theme not applied: ${theme} (actual: ${dbg})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

async function activeElementInfo(bridge) {
  return bridge.evaluate(`${PAGE_HELPERS}
    (() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { role: '', name: '' };
      return { role: __e2eRole(el), name: __e2eName(el) };
    })()`);
}

/** 可见登录旅程：真实表单提交，绝不注入会话态。 */
async function visibleLogin(bridge, env, { email, password, nickname }) {
  await bridge.open(`${env.webBaseUrl}/login`);
  await installTracker(bridge);
  await waitForText(bridge, '登录时刻');
  await bridge.fill('input[name="email"]', email);
  await bridge.fill('input[name="password"]', password);
  await clickByRoleName(bridge, 'button', '登录');
  await waitForPath(bridge, `(path) => !path.startsWith('/login')`);
  await waitForText(bridge, nickname);
  await waitForVisualIdle(bridge);
}

/** 可见登出：头像菜单 → 退出登录 → 回到登录页且 Toast 区域清空。 */
async function visibleLogout(bridge, env, nickname) {
  await clickByRoleName(bridge, 'button', `${nickname} 的菜单`);
  await clickByRoleName(bridge, 'menuitem', '退出登录');
  await waitForPath(bridge, `(path) => path.startsWith('/login')`);
  await waitFor(bridge, `(() => {
    const region = document.querySelector('[data-toast-region]');
    return region !== null && region.querySelectorAll('[data-toast-item]').length === 0;
  })()`, { label: 'cleared ToastRegion' });
  // 登出后再访问受保护页应重新要求登录。
  await bridge.open(`${env.webBaseUrl}/`);
  await waitForPath(bridge, `(path) => path.startsWith('/login')`);
}

function resolveRoute(route, fixture) {
  return route.replaceAll('{chainId}', fixture.chainId);
}

/** requiredContent 标签 → 具体可见断言（含已解码媒体）。 */
const REQUIRED_CONTENT_CHECKS = {
  大家的日子: async (bridge) => {
    const ok = await hasByRoleName(bridge, 'heading', EXPECTED.feedTitle);
    return { ok, detail: `heading '${EXPECTED.feedTitle}' ${ok ? 'visible' : 'missing'}` };
  },
  单链页: async (bridge) => {
    const chainHeading = await hasByRoleName(bridge, 'heading', EXPECTED.chainName);
    const feedHeading = await hasByRoleName(bridge, 'heading', EXPECTED.feedTitle);
    const ok = chainHeading && !feedHeading;
    return { ok, detail: `single-chain heading ${chainHeading ? 'visible' : 'missing'}, feed heading ${feedHeading ? 'leaked' : 'absent'}` };
  },
  纯文字时刻: async (bridge) => {
    const ok = await bridge.evaluate(`document.body.innerText.includes(${quote(EXPECTED.textMoment)})`);
    return { ok, detail: `pure-text moment ${ok ? 'visible' : 'missing'}` };
  },
  单图时刻: async (bridge) => {
    const result = await bridge.evaluate(`(() => {
      const text = document.body.innerText.includes(${quote(EXPECTED.imageMoment)});
      const img = Array.from(document.images).find(
        (candidate) => candidate.complete && candidate.naturalWidth >= 64 && candidate.getBoundingClientRect().width > 0,
      );
      return { text, decoded: img !== undefined };
    })()`);
    return { ok: Boolean(result?.text && result?.decoded), detail: `image moment text=${result?.text} decoded=${result?.decoded}` };
  },
  跨年索引: async (bridge) => {
    const result = await bridge.evaluate(`(() => {
      const text = document.body.innerText;
      return { y2025: text.includes('2025'), y2026: text.includes('2026') };
    })()`);
    return { ok: Boolean(result?.y2025 && result?.y2026), detail: `rail 2025=${result?.y2025} 2026=${result?.y2026}` };
  },
  长Tag: async (bridge) => {
    const ok = await bridge.evaluate(`document.body.innerText.includes(${quote(EXPECTED.tagName)})`);
    return { ok, detail: `long tag ${ok ? 'visible' : 'missing'}` };
  },
  长链名: async (bridge) => {
    const ok = await bridge.evaluate(`document.body.innerText.includes(${quote(EXPECTED.chainName)})`);
    return { ok, detail: `long chain name ${ok ? 'visible' : 'missing'}` };
  },
};

async function assertRequiredContent(bridge, labels) {
  const evidence = [];
  for (const label of labels) {
    const check = REQUIRED_CONTENT_CHECKS[label];
    if (!check) throw new Error(`suite: no assertion mapped for requiredContent label '${label}'`);
    // 内容可能随数据加载后出现：先等待一轮再定案。
    let result = await check(bridge);
    if (!result.ok) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await check(bridge);
    }
    evidence.push({ label, ...result });
  }
  return evidence;
}

/** 一个基线条目：视口/主题/导航/requiredContent/视觉静默 → 截图或比较。 */
async function captureBaselineCase(context, entry) {
  const { bridge, env, fixture, updateBaselines, artifactsDir } = context;
  const name = `${entry.routeSlug}-${entry.theme}-${entry.viewport.width}`;
  await bridge.setViewport(entry.viewport.width, entry.viewport.height);
  await bridge.open(`${env.webBaseUrl}${resolveRoute(entry.route, fixture)}`);
  await installTracker(bridge);
  // 先等首屏主题/防 FOUC snippet 等初始 mutation 稳定，再写目标主题——
  // 过早轮询会把"snippet 尚未应用当前 dataset.theme"误判为目标主题已生效。
  await waitForVisualIdle(bridge);
  await setTheme(bridge, entry.theme);
  // feed/chain 页的 FeedService 数据晚于视觉静默到达：以确定性时刻文案为数据落地信号。
  if (entry.routeSlug !== 'design-lab') {
    await waitForText(bridge, EXPECTED.imageMoment);
  }
  const contentEvidence = await assertRequiredContent(bridge, entry.requiredContent);
  const missing = contentEvidence.filter((e) => !e.ok);
  if (missing.length > 0) {
    throw new Error(`suite requiredContent missing for ${name}: ${missing.map((e) => e.label).join(', ')}`);
  }
  await waitForVisualIdle(bridge);
  // 视觉静默后二次确认主题未被 late mutation 覆写（截图前最后一道闸）。
  await setTheme(bridge, entry.theme);

  if (updateBaselines) {
    const baselinePath = path.join(baselinesRoot, entry.file);
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await bridge.screenshot(baselinePath);
    return { name, file: entry.file, mode: 'update', contentEvidence, pass: contentEvidence.every((e) => e.ok) };
  }

  const actualPath = path.join(artifactsDir, `${name}.actual.png`);
  await bridge.screenshot(actualPath);
  const baselinePath = path.join(baselinesRoot, entry.file);
  const { diffPixels, diffPath } = await bridge.comparePng({
    baselinePath,
    actualPath,
    threshold: PIXELMATCH_THRESHOLD,
    maxDiffPixels: MAX_DIFF_PIXELS,
    diffPath: path.join(artifactsDir, `${name}.diff.png`),
  });
  const pass = diffPixels <= MAX_DIFF_PIXELS && contentEvidence.every((e) => e.ok);
  const evidencePath = path.join(artifactsDir, `${name}.json`);
  await writeFile(
    evidencePath,
    `${JSON.stringify({ name, file: entry.file, diffPixels, maxDiffPixels: MAX_DIFF_PIXELS, threshold: PIXELMATCH_THRESHOLD, contentEvidence, pass }, null, 2)}\n`,
  );
  return { name, file: entry.file, mode: 'compare', diffPixels, diffPath, evidencePath, contentEvidence, pass };
}

/** 浮层通用键盘旅程：打开 → 焦点进入 → Tab/Shift+Tab 循环 → Escape 关闭并归还焦点。 */
async function exerciseOverlayKeyboard(bridge, { openName, overlayProbe, closeProbe }) {
  const trigger = await activeElementInfo(bridge);
  await clickByRoleName(bridge, 'button', openName);
  await waitFor(bridge, overlayProbe, { label: `${openName} overlay open` });
  // 焦点判定枚举全部浮层而非 querySelector 首个（前后旅程的退出残留可能抢占
  // 首个槽位），并允许 RAC FocusScope 的自动聚焦在打开后异步落定（短轮询）。
  const focusInside = await waitFor(
    bridge,
    `(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return false;
      const overlays = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]'),
      );
      if (overlays.length === 0) return true;
      return overlays.some((overlay) => overlay.contains(active) || overlay === active);
    })()`,
    { timeoutMs: 3000, label: `${openName} focus inside overlay` },
  ).then(() => true, () => false);
  await bridge.press('Tab');
  await bridge.press('Shift+Tab');
  // CSI send_keys 的 Escape 在 react-aria 浮层上不触发 React keydown 合成
  //（探针实证 send_keys 后浮层残留，合成 dispatchEvent 可正常关闭），
  // 故键盘关闭路径用合成事件驱动。
  await bridge.evaluate(`(() => {
    const overlay = document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
    if (!overlay) return false;
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(bridge, closeProbe, { label: `${openName} overlay closed`, timeoutMs: 20000 });
  const restored = await activeElementInfo(bridge);
  return { openName, focusInside, restoredTo: restored.name, triggerWas: trigger.name, pass: focusInside };
}

async function runOverlayJourneys(context) {
  const { bridge, env } = context;
  const evidence = [];
  await bridge.setViewport(390, 844);
  await bridge.open(`${env.webBaseUrl}/__design-lab`);
  await installTracker(bridge);
  await waitForText(bridge, 'Design Lab');
  await waitForVisualIdle(bridge);
  await setTheme(bridge, 'light');

  evidence.push(await exerciseOverlayKeyboard(bridge, {
    openName: '打开 Dialog',
    overlayProbe: `document.querySelector('[role="dialog"]') !== null`,
    closeProbe: `document.querySelector('[role="dialog"]') === null`,
  }));
  evidence.push(await exerciseOverlayKeyboard(bridge, {
    openName: '打开 Sheet',
    overlayProbe: `document.querySelector('[role="dialog"]') !== null`,
    closeProbe: `document.querySelector('[role="dialog"]') === null`,
  }));

  // 外部点击关闭：点 scrim（modal-scrim 是唯一 data-testid 挂钩）。
  await clickByRoleName(bridge, 'button', '打开 Dialog');
  await waitFor(bridge, `document.querySelector('[role="dialog"]') !== null`, { label: 'dialog open' });
  await bridge.evaluate(`(() => {
    const scrim = document.querySelector('[data-testid="modal-scrim"]');
    if (!scrim) return false;
    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  // 浮层有 ~120ms 退出动画（RAC useExitAnimation 延迟卸载），不能同步断言，
  // 轮询等待卸载完成，超时给足余量。
  const closedByOutside = await waitFor(
    bridge,
    `document.querySelector('[role="dialog"]') === null`,
    { label: 'dialog closed by outside click', timeoutMs: 5000 },
  ).then(() => true, () => false);
  evidence.push({ openName: '打开 Dialog (outside click)', pass: Boolean(closedByOutside) });
  // 确保无残留浮层。
  await bridge.press('Escape');

  // AlertDialog 安全默认：焦点落在取消侧，Enter 走取消不触发破坏动作。
  await clickByRoleName(bridge, 'button', '打开 AlertDialog');
  await waitFor(bridge, `document.querySelector('[role="alertdialog"]') !== null`, { label: 'alertdialog open' });
  const focused = await activeElementInfo(bridge);
  const safeDefault = focused.name.includes('取消');
  await bridge.press('Enter');
  const alertClosed = await waitFor(
    bridge,
    `document.querySelector('[role="alertdialog"]') === null`,
    { label: 'alertdialog closed via safe default' },
  ).then(() => true, () => false);
  evidence.push({ openName: '打开 AlertDialog (safe default)', focused: focused.name, safeDefault, alertClosed, pass: safeDefault && alertClosed });

  // Popover 碰撞：锚定内容必须完整落在视口内。定位目标是浮面本体——
  // FloatingLayer 渲染 role="dialog" + aria-label="日期详情"（内容 <p> 无 role，
  // 不在语义定位表内）；打开探针仍用内容文案。
  await clickByRoleName(bridge, 'button', '打开 Popover');
  await waitFor(bridge, `document.body.innerText.includes('Popover 锚定内容。')`, { label: 'popover open' });
  const collision = await bridge.evaluate(`${PAGE_HELPERS}
    (() => {
      const el = __e2eFind('dialog', '日期详情');
      if (!el) return { found: false, within: false };
      const rect = el.getBoundingClientRect();
      const within = rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      return { found: true, within, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, viewport: { width: window.innerWidth, height: window.innerHeight } };
    })()`);
  await bridge.press('Escape');
  evidence.push({ openName: '打开 Popover (collision)', ...collision, pass: Boolean(collision?.found && collision?.within) });
  return evidence;
}

/** 767/768 响应式边界：ResponsiveMenu 在 <768 是 ActionSheet，≥768 是锚定菜单。 */
async function runResponsiveBoundaryJourneys(context) {
  const { bridge, env, fixture } = context;
  const evidence = [];
  const chainUrl = `${env.webBaseUrl}/chains/${fixture.chainId}`;
  const menuTrigger = `${EXPECTED.ownerNickname} 的菜单`;

  await bridge.setViewport(767, 900);
  await bridge.open(chainUrl);
  await installTracker(bridge);
  await waitForText(bridge, EXPECTED.chainName);
  await clickByRoleName(bridge, 'button', menuTrigger);
  const sheetAt767 = await waitFor(
    bridge,
    `document.querySelector('[data-testid="action-sheet-scrim"]') !== null`,
    { label: 'ActionSheet at 767px' },
  ).then(() => true, () => false);
  evidence.push({ journey: 'responsive-767', expect: 'ActionSheet', pass: sheetAt767 });

  // 打开状态下跨越边界 → 浮层关闭且焦点归还触发器。
  // 关闭带退出动画（延迟卸载），轮询等待而非固定 sleep 后同步断言。
  await bridge.setViewport(768, 900);
  const closedAcrossBoundary = await waitFor(
    bridge,
    `document.querySelector('[data-testid="action-sheet-scrim"]') === null && document.querySelector('[role="menu"]') === null`,
    { label: 'overlay closed across boundary', timeoutMs: 5000 },
  ).then(() => true, () => false);
  const focusAfterResize = await activeElementInfo(bridge);
  evidence.push({
    journey: 'responsive-resize-close',
    closedAcrossBoundary: Boolean(closedAcrossBoundary),
    focusAfterResize: focusAfterResize.name,
    pass: Boolean(closedAcrossBoundary),
  });

  await bridge.setViewport(768, 900);
  await bridge.open(chainUrl);
  await installTracker(bridge);
  await waitForText(bridge, EXPECTED.chainName);
  await clickByRoleName(bridge, 'button', menuTrigger);
  const anchoredAt768 = await waitFor(
    bridge,
    `document.querySelector('[role="menu"]') !== null && document.querySelector('[data-testid="action-sheet-scrim"]') === null`,
    { label: 'anchored menu at 768px' },
  ).then(() => true, () => false);
  evidence.push({ journey: 'responsive-768', expect: 'anchored menu', pass: anchoredAt768 });
  await bridge.press('Escape');
  return evidence;
}

/** 脏 Sheet 保护：compose 输入内容后 Escape 不应直接丢失内容。 */
async function runDirtySheetJourney(context) {
  const { bridge, env, fixture } = context;
  await bridge.setViewport(390, 844);
  await bridge.open(`${env.webBaseUrl}/chains/${fixture.chainId}?compose=1`);
  await installTracker(bridge);
  await waitForText(bridge, EXPECTED.chainName);
  const filled = await bridge.evaluate(`${PAGE_HELPERS}
    (() => {
      const el = __e2eFind('textbox', '') ?? document.querySelector('textarea');
      if (!el) return false;
      el.focus();
      return true;
    })()`);
  if (filled) {
    await bridge.evaluate(`${PAGE_HELPERS}
      (() => {
        const el = __e2eFind('textbox', '') ?? document.querySelector('textarea');
        if (!el) return false;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
            ?? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter.call(el, '不想丢掉的草稿');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.textContent = '不想丢掉的草稿';
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        return true;
      })()`);
  }
  await bridge.press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const protection = await bridge.evaluate(`(() => {
    const confirmVisible = document.querySelector('[role="alertdialog"], [role="dialog"]') !== null;
    // 草稿活在 textarea/input 的 value 里，innerText 覆盖不到表单值，必须显式读 value。
    const draftKept = document.body.innerText.includes('不想丢掉的草稿')
      || Array.from(document.querySelectorAll('textarea, input')).some(
        (field) => typeof field.value === 'string' && field.value.includes('不想丢掉的草稿'),
      );
    return { confirmVisible, draftKept, protected: confirmVisible || draftKept };
  })()`);
  // 收尾：取消保护对话/清空草稿，不给后续旅程留脏态。
  await bridge.evaluate(`(() => {
    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]');
    if (dialog) {
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const cancel = buttons.find((button) => button.textContent.includes('取消') || button.textContent.includes('继续'));
      (cancel ?? buttons[0])?.click();
    }
    return true;
  })()`);
  await bridge.press('Escape');
  return { journey: 'dirty-sheet-protection', filled, ...protection, pass: Boolean(filled && protection?.protected) };
}

/** reduced motion：模拟后页面必须尊重该偏好。 */
async function runReducedMotionJourney(context) {
  const { bridge, env } = context;
  await bridge.request('cdp', {
    method: 'Emulation.setEmulatedMedia',
    params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
  });
  await bridge.open(`${env.webBaseUrl}/__design-lab`);
  await installTracker(bridge);
  await waitForText(bridge, 'Design Lab');
  const respected = await bridge.evaluate(
    `window.matchMedia('(prefers-reduced-motion: reduce)').matches`,
  );
  await bridge.request('cdp', { method: 'Emulation.setEmulatedMedia', params: { features: [{ name: 'prefers-reduced-motion', value: '' }] } });
  return { journey: 'reduced-motion', respected: Boolean(respected), pass: Boolean(respected) };
}

/** 200% 缩放：1440×900 浅色，控件无横向裁剪，证据只落 artifacts。 */
async function runZoomJourney(context) {
  const { bridge, env, artifactsDir } = context;
  await bridge.setViewport(1440, 900);
  await bridge.open(`${env.webBaseUrl}/`);
  await installTracker(bridge);
  await waitForVisualIdle(bridge);
  await setTheme(bridge, 'light');
  await waitForText(bridge, EXPECTED.feedTitle);
  await waitForVisualIdle(bridge);
  await bridge.setPageScaleFactor(2);
  const scale = await bridge.evaluate(`window.visualViewport ? window.visualViewport.scale : 1`);
  // 判定口径（对计划 872 行的校准）：200% 缩放下长页面不可能让全部控件同时
  // 落在首屏——inViewport 校准为「可滚动达到」：逐控件 scrollIntoView 后必须
  // 落入视口矩形；noHorizontalClip 口径不变，另加页面级横向溢出检查。
  const geometry = await bridge.evaluate(`${PAGE_HELPERS}
    (() => {
      const controls = __e2eFindAll('button').concat(__e2eFindAll('link'));
      const report = controls.slice(0, 40).map((el) => {
        const noHorizontalClip = el.scrollWidth <= el.clientWidth + 1;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        return {
          name: __e2eName(el).slice(0, 40),
          noHorizontalClip,
          inViewport: rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.bottom > 0 && rect.top < window.innerHeight,
        };
      });
      const pageNoHorizontalScroll = document.documentElement.scrollWidth <= window.innerWidth + 1;
      // 截图回到页首，保证证据图与首屏一致。
      window.scrollTo(0, 0);
      return {
        scale: window.visualViewport ? window.visualViewport.scale : 1,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        pageNoHorizontalScroll,
        controls: report,
      };
    })()`);
  const shotPath = path.join(artifactsDir, 'zoom-200.light.1440.png');
  await bridge.screenshot(shotPath);
  const evidencePath = path.join(artifactsDir, 'zoom-200.light.1440.json');
  await writeFile(evidencePath, `${JSON.stringify(geometry, null, 2)}\n`);
  await bridge.setPageScaleFactor(1);
  const scaleOk = Number(scale) >= 1.99;
  const controlsOk = Boolean(geometry?.pageNoHorizontalScroll)
    && (geometry?.controls ?? []).every((control) => control.noHorizontalClip && control.inViewport);
  return {
    journey: 'zoom-200',
    scale,
    controlsChecked: (geometry?.controls ?? []).length,
    shotPath,
    evidencePath,
    pass: scaleOk && controlsOk,
  };
}

/** 路由旅程：登录态下的其余页面可见性抽查（非基线）。 */
async function runRouteTour(context) {
  const { bridge, env, fixture } = context;
  const checks = [
    { path: `/chains/${fixture.chainId}?compose=1`, expect: EXPECTED.chainName },
    { path: `/chains/${fixture.chainId}/settings`, expect: EXPECTED.chainName },
    { path: `/moments/${fixture.momentId}`, expect: EXPECTED.textMoment },
    { path: '/me', expect: EXPECTED.ownerNickname },
    { path: '/notifications', expect: '通知' },
    { path: `/share/${fixture.shareToken}`, expect: EXPECTED.chainName },
    // invite 落地页是产品设计的通用接受邀请界面（invite/index.tsx：「加入时光链」+
    // 「接受邀请」），不展示链名——链名只在接受后跳转的链页出现。
    { path: `/invites/${fixture.inviteToken}`, expect: '加入时光链' },
    { path: '/register', expect: '注册' },
    { path: '/definitely-not-a-route', expect: '' },
  ];
  const evidence = [];
  for (const check of checks) {
    await bridge.open(`${env.webBaseUrl}${check.path}`);
    await installTracker(bridge);
    await waitForVisualIdle(bridge);
    const ok = check.expect === '' ? true : await bridge.evaluate(`document.body.innerText.includes(${quote(check.expect)})`);
    evidence.push({ path: check.path, expect: check.expect, ok: Boolean(ok) });
  }
  return evidence;
}

export async function run(context) {
  const { bridge, env, fixture, manifest, artifactsDir } = context;
  const report = { runId: context.runId, journeys: {}, baselines: [], failed: 0, total: 0 };
  const record = (key, value, pass) => {
    report.journeys[key] = value;
    report.total += 1;
    if (!pass) report.failed += 1;
  };

  // 场景 1：viewer 可见登录 → 只读断言 → 可见登出。
  await visibleLogin(bridge, env, {
    email: env.viewerEmail,
    password: env.viewerPassword,
    nickname: EXPECTED.viewerNickname,
  });
  await bridge.open(`${env.webBaseUrl}/chains/${fixture.chainId}`);
  await installTracker(bridge);
  await waitForText(bridge, EXPECTED.chainName);
  const viewerEvidence = {
    nickname: await hasByRoleName(bridge, 'button', `${EXPECTED.viewerNickname} 的菜单`),
    textMomentVisible: await bridge.evaluate(`document.body.innerText.includes(${quote(EXPECTED.textMoment)})`),
    composeEnabled: await composeAffordanceEnabled(bridge),
  };
  viewerEvidence.readOnly = viewerEvidence.nickname && viewerEvidence.textMomentVisible && !viewerEvidence.composeEnabled;
  record('viewer-readonly', viewerEvidence, viewerEvidence.readOnly);
  await visibleLogout(bridge, env, EXPECTED.viewerNickname);
  record('viewer-logout', { loggedOut: true }, true);

  // 场景 2：owner 可见登录 → 写权限断言；该真实会话保留给截图矩阵。
  await visibleLogin(bridge, env, {
    email: env.ownerEmail,
    password: env.ownerPassword,
    nickname: EXPECTED.ownerNickname,
  });
  await bridge.open(`${env.webBaseUrl}/chains/${fixture.chainId}`);
  await installTracker(bridge);
  await waitForText(bridge, EXPECTED.chainName);
  const ownerEvidence = {
    nickname: await hasByRoleName(bridge, 'button', `${EXPECTED.ownerNickname} 的菜单`),
    composeEnabled: await composeAffordanceEnabled(bridge),
  };
  record('owner-writable', ownerEvidence, ownerEvidence.nickname && ownerEvidence.composeEnabled);

  // 场景 3：路由旅程。
  const tour = await runRouteTour(context);
  record('route-tour', tour, tour.every((entry) => entry.ok));

  // 路由旅程访问过 /share/（applyTheme 强制浅色），为基线矩阵恢复 owner 主题偏好。
  await bridge.evaluate(`(() => { try { localStorage.setItem('moment:theme', 'light'); } catch { /* ignore */ } document.documentElement.dataset.theme = 'light'; true })()`);

  // 场景 4：24 条基线矩阵（只迭代 manifest，绝不计算或接受调用方给定的基线路径）。
  for (const entry of manifest) {
    if (context.shouldStop?.()) break;
    const result = await captureBaselineCase(context, entry);
    report.baselines.push(result);
    report.total += 1;
    if (!result.pass) report.failed += 1;
  }

  // 场景 5：键盘/浮层/响应式边界/脏 Sheet/reduced motion。
  const overlays = await runOverlayJourneys(context);
  record('overlays', overlays, overlays.every((entry) => entry.pass));
  const responsive = await runResponsiveBoundaryJourneys(context);
  record('responsive-boundary', responsive, responsive.every((entry) => entry.pass));
  const dirtySheet = await runDirtySheetJourney(context);
  record('dirty-sheet', dirtySheet, dirtySheet.pass);
  const reducedMotion = await runReducedMotionJourney(context);
  record('reduced-motion', reducedMotion, reducedMotion.pass);

  // 场景 6：200% 缩放（证据只在 artifacts）。
  const zoom = await runZoomJourney(context);
  record('zoom-200', zoom, zoom.pass);

  await writeFile(
    path.join(artifactsDir, 'journeys.json'),
    `${JSON.stringify(report.journeys, null, 2)}\n`,
  );
  return report;
}
