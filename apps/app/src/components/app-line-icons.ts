/**
 * lucide 单色线性图标数据（24×24 viewBox，内联常量，不引入运行时图标库；spec §4.4）。
 * 图元与 lucide-react@0.563.0 的 iconNode 逐枚同构（path/circle/line/rect），属性原样照抄。
 * 本模块是纯数据：不 import react / react-native-svg，保证纯 node vitest 可加载。
 * 词表只增不减。
 */

/** lucide 图元节点：[tag, attrs]。数值属性在 lucide 源里是字符串，此处归一为 number。 */
export type AppLineIconNode =
  | readonly ['path', { readonly d: string }]
  | readonly ['circle', { readonly cx: number; readonly cy: number; readonly r: number }]
  | readonly ['line', { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }]
  | readonly [
      'rect',
      { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx?: number },
    ];

export const APP_LINE_ICONS = {
  house: [
    ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
    [
      'path',
      { d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    ],
  ],
  'link-2': [
    ['path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }],
    ['path', { d: 'M15 7h2a5 5 0 1 1 0 10h-2' }],
    ['line', { x1: 8, x2: 16, y1: 12, y2: 12 }],
  ],
  bell: [
    ['path', { d: 'M10.268 21a2 2 0 0 0 3.464 0' }],
    [
      'path',
      { d: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326' },
    ],
  ],
  user: [
    ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 12, cy: 7, r: 4 }],
  ],
  'map-pin': [
    [
      'path',
      { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' },
    ],
    ['circle', { cx: 12, cy: 10, r: 3 }],
  ],
  settings: [
    [
      'path',
      {
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
      },
    ],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  calendar: [
    ['path', { d: 'M8 2v4' }],
    ['path', { d: 'M16 2v4' }],
    ['rect', { width: 18, height: 18, x: 3, y: 4, rx: 2 }],
    ['path', { d: 'M3 10h18' }],
  ],
  'message-circle': [
    [
      'path',
      {
        d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719',
      },
    ],
  ],
} as const satisfies Record<string, readonly AppLineIconNode[]>;

export type AppLineIconName = keyof typeof APP_LINE_ICONS;
