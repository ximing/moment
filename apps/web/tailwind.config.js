/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        muted: 'var(--ink-muted)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        line: 'var(--line)',
        danger: 'var(--danger)',
      },
      boxShadow: {
        paper: 'var(--shadow)',
      },
      borderRadius: {
        paper: 'var(--radius)',
      },
      maxWidth: {
        content: 'var(--content)',
      },
    },
  },
  plugins: [],
};
