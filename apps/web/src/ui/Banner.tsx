export function Banner({
  children,
  tone = 'error',
  action,
}: {
  children: string;
  tone?: 'error' | 'info';
  action?: { label: string; onClick: () => void };
}) {
  const cls = tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent';
  return (
    <div className={`flex items-center gap-3 rounded-paper px-3 py-2 text-sm ${cls}`}>
      <p className="flex-1">{children}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="shrink-0 underline">
          {action.label}
        </button>
      )}
    </div>
  );
}
