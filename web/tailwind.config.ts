import type { Config } from 'tailwindcss';

// SprintBrain dashboard — Tailwind v3 theme.
// Tokens mirror the legacy index.html palette so design language stays coherent
// with the marketing landing now served at /landing/.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#FAFAFA',
          alt: '#F2F2F7',
        },
        card: '#FFFFFF',
        primary: {
          DEFAULT: '#1B4FD8',
          dark: '#1440B0',
          light: '#EEF2FF',
        },
        ink: {
          DEFAULT: '#1C1C1E',
          muted: '#6E6E73',
          subtle: '#8E8E93',
        },
        line: '#E5E5EA',
        success: '#34C759',
        warning: '#FEBC2E',
        danger: '#FF5F57',
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
        content: '1280px',
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
