import { Button } from './Button';

export function Confirm({
  title,
  body,
  confirmLabel = '确定',
  danger,
  prompt,
  promptValue,
  onPromptChange,
  onCancel,
  onConfirm,
  busy,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  prompt?: { label: string; expect: string };
  promptValue?: string;
  onPromptChange?: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const blocked = prompt ? promptValue !== prompt.expect : false;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_40%,transparent)] p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-lg text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
        {prompt && (
          <input
            value={promptValue ?? ''}
            onChange={(e) => onPromptChange?.(e.target.value)}
            placeholder={prompt.label}
            className="mt-3 w-full rounded-card border border-line bg-surface px-3 py-2 text-ink"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={blocked || busy} onClick={onConfirm}>
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
