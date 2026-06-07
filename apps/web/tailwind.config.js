/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        stroke: 'var(--stroke)',
        action: 'var(--action)',
        'action-fg': 'var(--action-fg)',
        select: 'var(--select)',
        'select-fg': 'var(--select-fg)',
        today: 'var(--today)',
        'knot-yesterday': 'var(--knot-yesterday)',
        'knot-older': 'var(--knot-older)',
        danger: 'var(--danger)',
        'dot-pink': 'var(--dot-pink)',
        'dot-blue': 'var(--dot-blue)',
        'dot-mint': 'var(--dot-mint)',
        'dot-purple': 'var(--dot-purple)',
        'sticker-pink': 'var(--sticker-pink)',
        'sticker-blue': 'var(--sticker-blue)',
        'sticker-mint': 'var(--sticker-mint)',
        'sticker-purple': 'var(--sticker-purple)',
        'sticker-pink-line': 'var(--sticker-pink-line)',
        'sticker-blue-line': 'var(--sticker-blue-line)',
        'sticker-mint-line': 'var(--sticker-mint-line)',
        'sticker-purple-line': 'var(--sticker-purple-line)',
      },
      boxShadow: {
        card: 'var(--elev)',
        sticker: 'var(--elev-sm)',
        fab: '0 12px 28px color-mix(in srgb, var(--action) 35%, transparent)',
      },
      borderRadius: {
        card: 'var(--radius-lg)',
        sticker: '99px',
      },
      maxWidth: {
        content: 'var(--content)',
      },
      width: {
        sidebar: 'var(--sidebar)',
        rail: 'var(--rail)',
      },
      height: {
        control: 'var(--control-h)',
        'control-sm': 'var(--control-h-sm)',
        fab: 'var(--control-h-fab)',
      },
      padding: {
        sidebar: 'var(--space-3)',
      },
      inset: {
        sidebar: 'var(--sidebar)',
        rail: 'var(--rail)',
      },
    },
  },
  plugins: [],
};
