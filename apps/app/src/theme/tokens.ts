/**
 * Moment App 设计 Token（唯一允许出现 hex / rgba 字面量的文件）
 * 语义与取值对齐 apps/web/src/styles/tokens.css（浅色 + 深色双主题）；
 * 映射表见 docs/superpowers/specs/2026-08-20-app-design-tokens-design.md §3.2。
 * CSS 的 color-mix() 在 RN 不存在，一律预计算为静态字面量（算式见行内注释），
 * 禁止运行时换算。
 */

/** 色彩 token：两主题键集一致，仅取值不同 */
export interface ColorTokens {
  // ---- 基础色彩 ----
  bg: string; // 页面底
  surface: string; // 输入、文字内容、面板
  ink: string; // 主文字
  muted: string; // 时间、说明、次级动作
  line: string; // 必要边界
  stroke: string; // 日子线、圆环等时间结构
  action: string; // 主动作
  actionFg: string; // 动作色上的文字
  select: string; // 选中轻强调
  selectFg: string; // 选中色上的文字
  date: string; // 日期结、轻情绪入口
  tag: string; // 正文内 Tag
  focus: string; // 焦点 / Field focus 描边
  danger: string; // 危险动作
  dangerFg: string; // 危险实心按钮前景
  // ---- 链身份四色点 ----
  dotPink: string;
  dotBlue: string;
  dotMint: string;
  dotPurple: string;
  // ---- Field ----
  fieldBg: string;
  fieldBgDisabled: string;
  // ---- 浮层 ----
  scrim: string;
  hoverSoft: string; // ink 6%（深色 8%）
  pressedSoft: string; // ink 9%（深色 12%）
  secondaryBg: string; // Button secondary 色面：ink 7%（深色沿用 hover 8% 档）
  dangerSoft: string; // danger 7%（深色 10%）
  // ---- 反馈 ----
  feedbackErrorBg: string; // danger 10% mix surface（实算值，见注释）
  feedbackWarningBg: string; // select 18% mix surface
  feedbackInfoBg: string; // ink 5% mix surface
  feedbackSkeleton: string; // ink 7%
  toastShadowColor: string; // Toast 浮层阴影色（opacity 由组件按 scheme 取 0.18 / 0.42）
}

export const lightColors: ColorTokens = {
  bg: '#fff9f2',
  surface: '#ffffff',
  ink: '#232323',
  muted: '#6b635c',
  line: '#e8d5c4',
  stroke: '#c4a48a',
  action: '#ff6b35',
  actionFg: '#ffffff',
  select: '#ffc93c',
  selectFg: '#232323',
  date: '#f3edfb',
  tag: '#1f9d8a',
  focus: '#8b5fc7',
  danger: '#e8507a',
  dangerFg: '#ffffff',
  dotPink: '#e8507a',
  dotBlue: '#2ec4b6',
  dotMint: '#1f9d8a',
  dotPurple: '#8b5fc7',
  fieldBg: '#fff6ee',
  fieldBgDisabled: '#fff9f2',
  scrim: 'rgba(35, 35, 35, 0.36)',
  hoverSoft: 'rgba(35, 35, 35, 0.06)',
  pressedSoft: 'rgba(35, 35, 35, 0.09)',
  secondaryBg: 'rgba(35, 35, 35, 0.07)',
  dangerSoft: 'rgba(232, 80, 122, 0.07)',
  // color-mix(in srgb, #e8507a 10%, #ffffff)
  feedbackErrorBg: '#fdeef2',
  // color-mix(in srgb, #ffc93c 18%, #ffffff)
  feedbackWarningBg: '#fff5dc',
  // color-mix(in srgb, #232323 5%, #ffffff)
  feedbackInfoBg: '#f4f4f4',
  feedbackSkeleton: 'rgba(35, 35, 35, 0.07)',
  toastShadowColor: '#232323',
};

export const darkColors: ColorTokens = {
  bg: '#232323',
  surface: '#3f3933',
  ink: '#fff9f2',
  muted: '#c4b8ae',
  line: '#5a5048',
  stroke: '#8a827a',
  action: '#ff6b35',
  actionFg: '#ffffff',
  select: '#ffc93c',
  selectFg: '#232323',
  date: '#3f3a4a',
  tag: '#2ec4b6',
  focus: '#b89ae0',
  danger: '#ff7a9a',
  dangerFg: '#232323',
  dotPink: '#ff7a9a',
  dotBlue: '#5ed9cd',
  dotMint: '#3ec4b0',
  dotPurple: '#b08bdd',
  fieldBg: '#3a342f',
  fieldBgDisabled: '#322c28',
  scrim: 'rgba(0, 0, 0, 0.58)',
  hoverSoft: 'rgba(255, 249, 242, 0.08)',
  pressedSoft: 'rgba(255, 249, 242, 0.12)',
  secondaryBg: 'rgba(255, 249, 242, 0.08)',
  dangerSoft: 'rgba(255, 122, 154, 0.1)',
  // color-mix(in srgb, #ff7a9a 10%, #3f3933)
  feedbackErrorBg: '#52403d',
  // color-mix(in srgb, #ffc93c 18%, #3f3933)
  feedbackWarningBg: '#625335',
  // color-mix(in srgb, #fff9f2 5%, #3f3933)
  feedbackInfoBg: '#49433d',
  feedbackSkeleton: 'rgba(255, 249, 242, 0.07)',
  toastShadowColor: '#000000',
};

/** 间距 / 圆角 / 控件几何 / 字号 / 动效（两主题共享） */
export const sharedTokens = {
  // 间距档：页面与组件间距只许用这些档（编号对齐 web --space-*，无 space7）
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,
  space8: 32,
  // 圆角
  radiusMd: 14, // 内容色面
  radiusLg: 20, // 内容色面
  buttonRadius: 11,
  fieldRadius: 13,
  // 控件几何
  controlH: 40,
  controlHProminent: 44,
  fieldH: 44,
  touchMin: 44, // 一切可交互元素最小命中区（Apple HIG）
  buttonPx: 16,
  buttonPillPx: 20,
  pressedScale: 0.98,
  disabledOpacity: 0.42,
  // 字号全集
  fontCaption: 12,
  fontSupport: 13,
  fontLabel: 14,
  fontBody: 15,
  fontInput: 16,
  // 动效时长（Animated / LayoutAnimation）
  easeMs: 180,
  easeInMs: 120,
} as const;

export type SharedTokens = typeof sharedTokens;
