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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-paper bg-paper p-5 shadow-paper">
        <h2 className="font-display text-lg text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
        {prompt && (
          <input
            value={promptValue ?? ''}
            onChange={(e) => onPromptChange?.(e.target.value)}
            placeholder={prompt.label}
            className="mt-3 w-full rounded-paper border border-line bg-white/70 px-3 py-2"
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
