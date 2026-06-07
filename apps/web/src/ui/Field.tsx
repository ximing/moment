import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm text-muted">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

const inputClass =
  'w-full min-w-0 rounded-card border border-line bg-surface px-3 text-ink placeholder:text-[color-mix(in_srgb,var(--muted)_70%,transparent)] focus:border-action';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-10 ${inputClass} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} min-h-[7rem] resize-y ${props.className ?? ''}`} />;
}
