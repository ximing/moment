import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'quiet';

const VARIANT: Record<Variant, string> = {
  primary: 'border-line bg-action text-action-fg hover:opacity-90',
  ghost: 'border-line bg-surface text-ink hover:opacity-90',
  danger: 'border-danger bg-surface text-danger hover:opacity-90',
  quiet: 'border-transparent text-muted shadow-none hover:text-ink',
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-sticker border-2 px-3.5 py-2 text-sm shadow-sticker transition duration-[var(--ease)] disabled:opacity-40 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
