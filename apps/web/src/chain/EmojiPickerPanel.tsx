import { EmojiPicker } from 'frimousse';
import type { ComponentProps } from 'react';

// 离线 Emoji 选择面板（spec §7.2 / plan Task 7）：
// frimousse 默认从 jsDelivr 拉 Emojibase 数据——内网部署下不可用。数据经
// vite-plugin-static-copy 随构建产物部署到同源 /vendor/emojibase，运行时只请求
// 同源 JSON，不触碰公共 CDN。组件自身走 lazy chunk，只有进入 Emoji 模式才下载。
// 样式只消费 Moment 的 spacing / radius / surface / text / action token，不引入
// frimousse 默认视觉皮肤。
//
// frimousse 的 d.ts 由 hoisted 根 @types/react（19.1.x）解析，而 apps/web 源码使用
// apps/web/node_modules/@types/react（19.2.x），两份同名 Ref<> 名义上不兼容。
// 组件签名按 19.2 的 ComponentProps 显式落型，隔离这条库类型接缝。

export interface EmojiPickerPanelProps {
  onSelect(emoji: string): void;
}

type DivProps = ComponentProps<'div'>;
type ButtonProps = ComponentProps<'button'>;

export function EmojiPickerPanel({ onSelect }: EmojiPickerPanelProps) {
  return (
    <div className="overflow-hidden rounded-surface-md border border-line bg-surface">
      <EmojiPicker.Root
        locale="zh"
        emojiVersion={17}
        emojibaseUrl="/vendor/emojibase"
        onEmojiSelect={({ emoji }) => onSelect(emoji)}
        className="flex h-72 flex-col"
      >
        <EmojiPicker.Search
          aria-label="搜索 Emoji"
          placeholder="搜索 Emoji"
          className="m-2 h-field rounded-field bg-field-bg px-field text-[length:var(--field-text-size)] text-ink outline-none transition-[background-color,box-shadow] duration-[var(--ease)] placeholder:text-field-placeholder hover:bg-field-bg-hover focus-visible:ring-field focus-visible:ring-field-focus"
        />
        <EmojiPicker.Viewport className="min-h-0 flex-1">
          <EmojiPicker.Loading>
            <p className="p-4 text-meta text-muted">正在载入 Emoji…</p>
          </EmojiPicker.Loading>
          <EmojiPicker.Empty>
            <p className="p-4 text-meta text-muted">没有找到 Emoji</p>
          </EmojiPicker.Empty>
          <EmojiPicker.List
            components={{
              CategoryHeader: ({ category, ...props }) => (
                <div
                  className="bg-surface px-3 py-2 text-caption text-muted"
                  {...(props as DivProps)}
                >
                  {category.label}
                </div>
              ),
              Row: ({ children, ...props }) => (
                <div className="px-2" {...(props as DivProps)}>
                  {children}
                </div>
              ),
              Emoji: ({ emoji, ...props }) => (
                <button
                  type="button"
                  aria-label={`选择 ${emoji.label}`}
                  className="flex h-8 w-8 items-center justify-center rounded-surface-md text-lg outline-none transition-colors duration-[var(--ease)] hover:bg-floating-hover data-[active]:bg-floating-hover focus-visible:ring-focus"
                  {...(props as ButtonProps)}
                >
                  {emoji.emoji}
                </button>
              ),
            }}
          />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
}
