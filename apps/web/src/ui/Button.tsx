import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'quiet';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  ghost: 'border border-line bg-paper text-ink hover:bg-white/60',
  danger: 'bg-danger text-white hover:opacity-90',
  quiet: 'text-muted hover:text-ink hover:bg-white/50',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-paper px-3.5 py-2 text-sm transition-opacity disabled:opacity-40 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
