import { CHAIN_COLORS, type ChainAppearanceColor } from '@moment/dto';
import { Suspense, lazy, useRef, useState } from 'react';
import { chainColorCss, normalizeChainHex } from '@/lib/chain-color';
import { Button } from '@/ui/button/index';
import { InlineProgress } from '@/ui/feedback/index';
import { TextField } from '@/ui/field/index';
import type {
  ChainAppearanceDraft,
  ChainAvatarMode,
  ChainImageDraft,
} from './appearance-model';
import { focusObjectPosition } from './appearance-model';
import { FocalImageEditor } from './FocalImageEditor';

// ChainAppearanceEditor（spec §7.1 / plan Task 7）：创建链与链设置共用的受控外观编辑器。
// 不直接访问全局 client——draft 只读，所有变更经 actions 回调；上传状态机由页面
// Service 持有（plan Task 8）。Emoji 面板按需 lazy 加载（离线 emojibase 数据不进主 chunk）。

const LazyEmojiPickerPanel = lazy(() =>
  import('./EmojiPickerPanel').then((m) => ({ default: m.EmojiPickerPanel })),
);

export type ChainImagePlacement = 'avatar' | 'cover';

export interface ChainAppearanceActions {
  onSetAvatarMode(mode: ChainAvatarMode): void;
  onSelectEmoji(emoji: string): void;
  onSelectColor(color: string): void;
  onPickImage(placement: ChainImagePlacement, file: File): void;
  onRemoveImage(placement: ChainImagePlacement): void;
  onRetryImage(placement: ChainImagePlacement): void;
  onSetFocus(placement: ChainImagePlacement, focus: { x: number; y: number }): void;
}

export interface ChainAppearanceEditorProps {
  draft: ChainAppearanceDraft;
  actions: ChainAppearanceActions;
}

const MODE_TABS: { mode: ChainAvatarMode; label: string }[] = [
  { mode: 'emoji', label: 'Emoji' },
  { mode: 'image', label: '图片' },
  { mode: 'color', label: '纯色' },
];

export function ChainAppearanceEditor({ draft, actions }: ChainAppearanceEditorProps) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [focusEditing, setFocusEditing] = useState<ChainImagePlacement | null>(null);

  // 焦点编辑器内联替换对应区块；确认/取消都关闭（取消由 FocalImageEditor 自己恢复初值）
  const focusTarget = focusEditing === 'avatar' ? draft.avatar : draft.cover;

  return (
    <div className="space-y-4">
      {/* 头像：三段互斥模式 */}
      <section aria-label="头像" className="space-y-3">
        <div className="flex gap-2">
          {MODE_TABS.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={draft.avatarMode === mode}
              onClick={() => actions.onSetAvatarMode(mode)}
              className={`h-control rounded-button px-button text-sm font-medium transition-colors duration-[var(--ease)] focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-offset-focus focus-visible:ring-offset-bg ${
                draft.avatarMode === mode
                  ? 'bg-select text-select-fg'
                  : 'bg-transparent text-muted hover:bg-floating-hover hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {draft.avatarMode === 'emoji' ? (
          <EmojiSection
            icon={draft.icon}
            pickerOpen={emojiPickerOpen}
            onTogglePicker={() => setEmojiPickerOpen((v) => !v)}
            onSelect={(emoji) => {
              actions.onSelectEmoji(emoji);
              setEmojiPickerOpen(false);
            }}
          />
        ) : null}

        {draft.avatarMode === 'color' ? (
          <ColorSection color={draft.color} onSelectColor={actions.onSelectColor} />
        ) : null}

        {draft.avatarMode === 'image' ? (
          focusEditing === 'avatar' && focusTarget?.src ? (
            <FocalImageEditor
              src={focusTarget.src}
              focus={focusTarget.focus}
              label="头像"
              variant="circle"
              onConfirm={(focus) => {
                actions.onSetFocus('avatar', focus);
                setFocusEditing(null);
              }}
              onCancel={() => setFocusEditing(null)}
            />
          ) : (
            <ImageSection
              placement="avatar"
              label="头像"
              image={draft.avatar}
              previewVariant="circle"
              onPick={actions.onPickImage}
              onRemove={actions.onRemoveImage}
              onRetry={actions.onRetryImage}
              onEditFocus={() => setFocusEditing('avatar')}
            />
          )
        ) : null}
      </section>

      {/* 封面：独立于头像模式 */}
      <section aria-label="封面" className="space-y-3">
        <p className="text-sm font-medium text-ink">封面</p>
        {focusEditing === 'cover' && focusTarget?.src ? (
          <FocalImageEditor
            src={focusTarget.src}
            focus={focusTarget.focus}
            label="封面"
            variant="wide"
            onConfirm={(focus) => {
              actions.onSetFocus('cover', focus);
              setFocusEditing(null);
            }}
            onCancel={() => setFocusEditing(null)}
          />
        ) : (
          <ImageSection
            placement="cover"
            label="封面"
            image={draft.cover}
            previewVariant="wide"
            onPick={actions.onPickImage}
            onRemove={actions.onRemoveImage}
            onRetry={actions.onRetryImage}
            onEditFocus={() => setFocusEditing('cover')}
          />
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Emoji 模式
 * ------------------------------------------------------------------------- */

function EmojiSection({
  icon,
  pickerOpen,
  onTogglePicker,
  onSelect,
}: {
  icon: string | null;
  pickerOpen: boolean;
  onTogglePicker(): void;
  onSelect(emoji: string): void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-2xl"
        >
          {icon ?? '·'}
        </span>
        <Button
          variant="secondary"
          aria-expanded={pickerOpen}
          aria-label={icon ? `选择 Emoji，当前 ${icon}` : '选择 Emoji'}
          onClick={onTogglePicker}
        >
          {icon ? `${icon} 更换 Emoji` : '选择 Emoji'}
        </Button>
      </div>
      {pickerOpen ? (
        <Suspense fallback={<p className="text-meta text-muted">正在载入 Emoji…</p>}>
          <LazyEmojiPickerPanel onSelect={onSelect} />
        </Suspense>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 纯色模式
 * ------------------------------------------------------------------------- */

function ColorSection({
  color,
  onSelectColor,
}: {
  color: string | null;
  onSelectColor(color: string): void;
}) {
  const [hexText, setHexText] = useState('');
  const [hexInvalid, setHexInvalid] = useState(false);
  // 外部颜色变化（预设/取色器）时重置输入框与错误：
  // render 期间记录上一次的 color，变化即清——避免 effect 内同步 setState 的级联渲染。
  const [prevColor, setPrevColor] = useState(color);
  if (color !== prevColor) {
    setPrevColor(color);
    setHexText('');
    setHexInvalid(false);
  }

  const commitHex = () => {
    if (hexText.trim() === '') {
      setHexInvalid(false);
      return;
    }
    const normalized = normalizeChainHex(hexText);
    if (normalized === null) {
      // 非法 hex 保留输入并显示错误，不提交旧值冒充成功（spec §7.3）
      setHexInvalid(true);
      return;
    }
    setHexInvalid(false);
    onSelectColor(normalized);
  };

  const previewCss = color ? chainColorCss(color as ChainAppearanceColor) : 'var(--surface)';
  const isHex = color?.startsWith('#') ?? false;
  const pickerValue = isHex ? color! : '#A1B2C3';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          data-testid="color-preview"
          className="h-12 w-12 rounded-full border border-line"
          style={{ background: previewCss }}
        />
        <div className="flex flex-wrap gap-2">
          {CHAIN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => onSelectColor(c)}
              className={`h-8 w-8 rounded-full focus-visible:outline-none focus-visible:ring-focus ${
                color === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''
              }`}
              style={{ background: chainColorCss(c) }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-field-label text-[length:var(--field-label-size)] font-medium text-ink">
          自定义颜色
          <input
            type="color"
            value={pickerValue}
            onChange={(event) => onSelectColor(event.target.value.toUpperCase())}
            className="h-field w-16 cursor-pointer rounded-field bg-field-bg p-1 focus-visible:outline-none focus-visible:ring-field focus-visible:ring-field-focus"
          />
        </label>
        {hexInvalid ? (
          <TextField
            label="颜色代码"
            name="chain-color-hex"
            value={hexText}
            onChange={setHexText}
            onBlur={commitHex}
            placeholder="#RRGGBB"
            isInvalid
            errorMessage="颜色格式不正确"
            className="w-32"
          />
        ) : (
          <TextField
            label="颜色代码"
            name="chain-color-hex"
            value={hexText}
            onChange={setHexText}
            onBlur={commitHex}
            placeholder="#RRGGBB"
            className="w-32"
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 图片区块（头像/封面共用）
 * ------------------------------------------------------------------------- */

function ImageSection({
  placement,
  label,
  image,
  previewVariant,
  onPick,
  onRemove,
  onRetry,
  onEditFocus,
}: {
  placement: ChainImagePlacement;
  label: string;
  image: ChainImageDraft | null;
  previewVariant: 'circle' | 'wide';
  onPick(placement: ChainImagePlacement, file: File): void;
  onRemove(placement: ChainImagePlacement): void;
  onRetry(placement: ChainImagePlacement): void;
  onEditFocus(): void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      aria-label={`选择${label}图片`}
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) onPick(placement, file);
        // 允许再次选择同一文件
        event.target.value = '';
      }}
    />
  );

  if (!image) {
    return (
      <div>
        {fileInput}
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          选择{label}图片
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fileInput}
      <div
        className={`overflow-hidden bg-field-bg ${
          previewVariant === 'circle'
            ? 'h-24 w-24 rounded-full'
            : 'aspect-[3/1] w-full rounded-surface-md'
        }`}
      >
        {image.src ? (
          <img
            src={image.src}
            alt={`${label}预览`}
            className="h-full w-full object-cover"
            style={{ objectPosition: focusObjectPosition(image.focus) }}
          />
        ) : null}
      </div>

      {image.fileName ? <p className="text-meta text-muted">{image.fileName}</p> : null}

      {image.status === 'uploading' ? (
        <InlineProgress
          variant="determinate"
          value={image.progress}
          label={`上传${label} ${Math.round(image.progress)}%`}
        />
      ) : null}

      {image.status === 'error' ? (
        <p className="text-meta text-field-danger">{image.error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          重新选择
        </Button>
        {image.status === 'ready' ? (
          <Button variant="secondary" onClick={onEditFocus} aria-label={`调整${label}位置`}>
            调整位置
          </Button>
        ) : null}
        {image.status === 'error' ? (
          <Button
            variant="secondary"
            onClick={() => onRetry(placement)}
            aria-label={`重试上传${label}`}
          >
            重试
          </Button>
        ) : null}
        <Button
          variant="quiet"
          onClick={() => onRemove(placement)}
          aria-label={`删除${label}`}
        >
          删除
        </Button>
      </div>
    </div>
  );
}
