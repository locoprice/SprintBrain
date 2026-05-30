import type { Config } from 'tailwindcss';

// SprintBrain dashboard — Tailwind v3 theme.
// Tokens mirror the legacy index.html palette so design language stays coherent
// with the marketing landing now served at /landing/.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-sensitive tokens — resolved via CSS variables (light/dark mode aware)
        bg: {
          DEFAULT: 'var(--color-bg)',
          alt: 'var(--color-bg-alt)',
        },
        card: 'var(--color-card)',
        ink: {
          DEFAULT: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
          subtle: 'var(--color-ink-subtle)',
        },
        line: 'var(--color-line)',
        // Brand + status tokens — fixed across themes
        primary: {
          DEFAULT: '#1B4FD8',
          dark: '#1440B0',
          light: '#EEF2FF',
        },
        success: '#34C759',
        warning: '#FEBC2E',
        danger: '#D70015',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SF Mono',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        sm: '0 1px 3px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.04)',
        md: '0 4px 20px rgba(27,79,216,.12), 0 1px 3px rgba(0,0,0,.06)',
      },
      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
      },
      maxWidth: {
        content: '1600px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
