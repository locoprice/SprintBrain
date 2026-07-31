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
        warning: {
          DEFAULT: '#FEBC2E',
          // Amber that holds contrast as *text/icon* on `warning-bg`; the flat
          // `warning` above is a fill. Mirrors --sb-warn in the extension tokens.
          deep: '#D97706',
          bg: '#FFFBEB',
        },
        danger: {
          DEFAULT: '#D70015',
          bg: '#FEF2F2',
        },
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
        // Status badges (STATUS-ICONS-001). Transform/opacity only, so every
        // frame stays on the compositor and never triggers layout.
        'status-pop': {
          '0%': { opacity: '0', transform: 'scale(0.4)' },
          '70%': { opacity: '1', transform: 'scale(1.12)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'status-wobble': {
          '0%, 100%': { transform: 'rotate(-9deg)' },
          '50%': { transform: 'rotate(9deg)' },
        },
        'status-cheer': {
          '0%, 100%': { transform: 'scale(1) rotate(0deg)' },
          '30%': { transform: 'scale(1.18) rotate(-10deg)' },
          '65%': { transform: 'scale(1.18) rotate(10deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'status-pop': 'status-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'status-wobble': 'status-wobble 2400ms cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'status-cheer': 'status-cheer 520ms cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
