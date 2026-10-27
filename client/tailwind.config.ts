// client/tailwind.config.ts
import type { Config } from 'tailwindcss';

const c = (v: string) => `rgb(var(--color-${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  // Xác minh với tài liệu chính thức của Tailwind CSS: cú pháp darkMode 'selector' (v3.4+); bản cũ dùng ['class', '[data-theme="dark"]'].
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: c('primary'), hover: c('primary-hover'), on: c('on-primary') },
        surface: { DEFAULT: c('surface'), 2: c('surface-2'), 3: c('surface-3') },
        bubble: { out: c('bubble-out'), 'on-out': c('on-bubble-out'), in: c('bubble-in') },
        text: { DEFAULT: c('text'), secondary: c('text-secondary') },
        border: { DEFAULT: c('border'), strong: c('border-strong') },
        success: c('success'),
        online: c('online'),
        warning: c('warning'),
        danger: { DEFAULT: c('danger'), on: c('on-danger') },
        overlay: c('overlay'),
        call: c('call-bg'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '22px' }],
        md: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '28px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['30px', { lineHeight: '36px' }],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', bubble: '18px', pill: '9999px' },
      boxShadow: {
        sm: '0 1px 2px rgb(0 0 0 / 0.06)',
        md: '0 4px 12px rgb(0 0 0 / 0.10)',
        lg: '0 12px 32px rgb(0 0 0 / 0.18)',
        pip: '0 8px 24px rgb(0 0 0 / 0.40)',
      },
      zIndex: {
        base: '0',
        sticky: '10',
        dropdown: '30',
        banner: '40',
        modal: '50',
        toast: '60',
        call: '70',
        incoming: '80',
        skiplink: '90',
      },
      spacing: { 'safe-t': 'var(--safe-top)', 'safe-b': 'var(--safe-bottom)' },
      screens: { md: '768px', lg: '1024px', xl: '1280px' },
      keyframes: {
        'typing-dot': { '0%,80%,100%': { opacity: '0.3' }, '40%': { opacity: '1' } },
        'ring-pulse': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: { 'typing-dot': 'typing-dot 1.2s infinite', 'ring-pulse': 'ring-pulse 1.5s ease-out infinite' },
    },
  },
  plugins: [],
} satisfies Config;
