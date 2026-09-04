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
  bg: '#f6f1ec',
  surface: '#fffdfb',
  ink: '#2b201c',
  muted: '#6f5d54',
  line: '#d8c9c0',
  stroke: '#b79989',
  action: '#c94a3a',
  actionFg: '#fffdfb',
  select: '#f2b84b',
  selectFg: '#2b201c',
  date: '#ded4ff',
  tag: '#4b7562',
  focus: '#7656d8',
  danger: '#b83a30',
  dangerFg: '#fffdfb',
  dotPink: '#ff7aa2',
  dotBlue: '#5aa7d6',
  dotMint: '#4cbe8a',
  dotPurple: '#9b8fd0',
  fieldBg: '#f0e9e4',
  fieldBgDisabled: '#f3eeea',
  scrim: 'rgba(43, 32, 28, 0.36)',
  hoverSoft: 'rgba(43, 32, 28, 0.06)',
  pressedSoft: 'rgba(43, 32, 28, 0.09)',
  secondaryBg: 'rgba(43, 32, 28, 0.07)',
  dangerSoft: 'rgba(184, 58, 48, 0.07)',
  // color-mix(in srgb, #b83a30 10%, #fffdfb) 实算
  feedbackErrorBg: '#f8eae7',
  // color-mix(in srgb, #f2b84b 18%, #fffdfb) 实算
  feedbackWarningBg: '#fdf1db',
  // color-mix(in srgb, #2b201c 5%, #fffdfb) 实算
  feedbackInfoBg: '#f4f2f0',
  feedbackSkeleton: 'rgba(43, 32, 28, 0.07)',
  toastShadowColor: '#2b201c',
};

export const darkColors: ColorTokens = {
  bg: '#171412',
  surface: '#26211e',
  ink: '#f7efe9',
  muted: '#c3b5ad',
  line: '#463c37',
  stroke: '#76675f',
  action: '#ff755e',
  actionFg: '#241714',
  select: '#f2b84b',
  selectFg: '#2b201c',
  date: '#433b5e',
  tag: '#87c2a5',
  focus: '#b59cff',
  danger: '#ff8a72',
  dangerFg: '#2b201c',
  dotPink: '#ff9bb8',
  dotBlue: '#86c4e4',
  dotMint: '#78d4a8',
  dotPurple: '#c0b0e8',
  fieldBg: '#1f1a17',
  fieldBgDisabled: '#201c19',
  scrim: 'rgba(0, 0, 0, 0.58)',
  hoverSoft: 'rgba(247, 239, 233, 0.08)',
  pressedSoft: 'rgba(247, 239, 233, 0.12)',
  secondaryBg: 'rgba(247, 239, 233, 0.08)',
  dangerSoft: 'rgba(255, 138, 114, 0.1)',
  // color-mix(in srgb, #ff8a72 10%, #26211e) 实算
  feedbackErrorBg: '#3c2c26',
  // color-mix(in srgb, #f2b84b 18%, #26211e) 实算
  feedbackWarningBg: '#4b3c26',
  // color-mix(in srgb, #f7efe9 5%, #26211e) 实算
  feedbackInfoBg: '#302b28',
  feedbackSkeleton: 'rgba(247, 239, 233, 0.07)',
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
