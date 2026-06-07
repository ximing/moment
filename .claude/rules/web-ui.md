---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
---

# Web Design System

暖纸色板已定（`tokens.css`）。这里管 **尺度和对齐**。禁止再写 `px-[18px]` / `h-[52px]` / `-mx-3.5` 这种一次性尺寸。

## 尺度（只准用这些）

| token | 值 | 用途 |
|---|---|---|
| `--space-1` … `--space-8` | 4 / 8 / 12 / 16 / 20 / 24 / 32 | 间距。Tailwind `p-1`…`p-8` 即此档 |
| `--control-h` / `--control-h-sm` | 40 / 32 | 按钮、单行输入、select |
| `--control-h-fab` | 48 | 右下「记下」 |
| `--radius-lg` / `rounded-card` | 20 | 气泡、面板、composer |
| `rounded-sticker` | 满圆 | 药丸按钮、FAB |
| `--sidebar` / `--rail` | 168 / 148 | 左右栏 |

控件高度用已有 Tailwind 档：`h-10`（40）、`h-8`（32）、FAB 用 `h-12`（48）。侧栏宽用 `w-[var(--sidebar)]`。不要发明 `h-control` 这类尚未进产物的自定义 utility。

## 对齐网格

- **侧栏**：`px-3 pt-6`。导航 `flex-1`，用户钉在左栏最底下。头像 24，和链标同一列、`px-2 py-1.5`。分隔线拉满侧栏，线到用户、用户到窗口各 16px。菜单在侧栏内向上弹。
- **时间线一条时刻**：`[头像 32] + gap-3 + [内容列]`。名字、正文/图、表情、评论数、评论列表全部在内容列里，左缘同一条线。禁止文字气泡内再塞表情（会比图片那条多缩进 16px）。
- **文字**：只有正文进软气泡（`rounded-card bg-surface px-4 py-3`）。图/视频自己当底。
- **FAB**：`bottom-6 right-6`，`h-fab px-5 gap-2`。

## 控件

- 只走 `Button`：`primary` / `ghost`（细线） / `quiet`（无框） / `danger`。`md`=40，`sm`=32。
- 图标只走 `Icon`（Lucide）。反应仍用 dto emoji。
- 一行里：输入 `min-w-0`，按钮 `shrink-0`。挤不下就 `flex-col`，不要让按钮贴边或把字挤换行。

## Menu

- 默认 `inline-block`。侧栏用户行用 `fullWidth`，宽度等于导航项，不是 aside 外沿。
