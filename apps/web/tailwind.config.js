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
        action: 'var(--action)',
        'action-fg': 'var(--action-fg)',
        select: 'var(--select)',
        danger: 'var(--danger)',
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
        card: '4px 4px 0 var(--shadow)',
        sticker: '2px 2px 0 var(--shadow)',
      },
      borderRadius: {
        card: '16px',
        sticker: '99px',
      },
      maxWidth: {
        content: 'var(--content)',
      },
    },
  },
  plugins: [],
};
