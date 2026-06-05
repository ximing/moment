export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const ch = (name.trim()[0] ?? '·').toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-select text-ink"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {ch}
    </span>
  );
}
