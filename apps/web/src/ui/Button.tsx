import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'quiet';
type Size = 'md' | 'sm';

const VARIANT: Record<Variant, string> = {
  primary: 'border-transparent bg-action text-action-fg hover:opacity-90',
  ghost: 'border-line bg-transparent text-ink hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]',
  danger: 'border-transparent bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] text-danger hover:opacity-90',
  quiet: 'border-transparent text-muted shadow-none hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink',
};

const SIZE: Record<Size, string> = {
  md: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sticker border ${SIZE[size]} transition duration-[var(--ease)] disabled:opacity-40 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
