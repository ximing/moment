export function Banner({
  children,
  tone = 'error',
  action,
}: {
  children: string;
  tone?: 'error' | 'info';
  action?: { label: string; onClick: () => void };
}) {
  const cls = tone === 'error' ? 'text-danger' : 'text-action';
  return (
    <div
      className={`flex items-center gap-3 rounded-card border border-line bg-surface px-3 py-2 text-sm shadow-card ${cls}`}
    >
      <p className="flex-1">{children}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="shrink-0 underline">
          {action.label}
        </button>
      )}
    </div>
  );
}
