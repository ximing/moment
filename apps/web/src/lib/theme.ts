export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'moment:theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* localStorage 不可用按 system */
  }
  return 'system';
}

/** 与 index.html 内联 snippet 同规则（防 FOUC 屏障在 snippet；本函数负责运行时切换）。 */
export function applyTheme(): void {
  let t: ThemeChoice = getThemeChoice();
  // 分享页恒浅：无视 localStorage 与系统偏好（spec §1.5）
  if (window.location.pathname.startsWith('/share/')) t = 'light';
  const resolved =
    t === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : t;
  document.documentElement.dataset.theme = resolved;
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* 忽略写失败，本次会话内仍生效 */
  }
  applyTheme();
}

/** system 主题跟随：返回解绑函数。/share/ 守卫内置在 applyTheme 内，此监听同样不生效。 */
export function subscribeSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme();
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
