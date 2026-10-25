import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          dim: 'rgb(var(--color-accent-dim) / <alpha-value>)',
        },
        // Gray goes through CSS variables so the yellow-white theme can warm every gray class at once
        // (index.css). Defaults are Tailwind's own gray, so light/dark look unchanged.
        gray: {
          50: 'rgb(var(--gray-50) / <alpha-value>)',
          100: 'rgb(var(--gray-100) / <alpha-value>)',
          200: 'rgb(var(--gray-200) / <alpha-value>)',
          300: 'rgb(var(--gray-300) / <alpha-value>)',
          400: 'rgb(var(--gray-400) / <alpha-value>)',
          500: 'rgb(var(--gray-500) / <alpha-value>)',
          600: 'rgb(var(--gray-600) / <alpha-value>)',
          700: 'rgb(var(--gray-700) / <alpha-value>)',
          800: 'rgb(var(--gray-800) / <alpha-value>)',
          900: 'rgb(var(--gray-900) / <alpha-value>)',
          950: 'rgb(var(--gray-950) / <alpha-value>)',
        },
        // Yellow-white surfaces (promo-collab/film-promo/page.html:3).
        cream: { 50: '#FFFCF5', 100: '#FFF4D9', 200: '#FFE9B8' },
      },
      // Text uses its own accent variable: the yellow-white accent #F2994A is too light for text
      // (2.2:1), so text-accent there is a darker orange (>= 4.5:1). Elsewhere it equals the accent.
      textColor: {
        accent: {
          DEFAULT: 'rgb(var(--color-accent-text) / <alpha-value>)',
          dim: 'rgb(var(--color-accent-text-dim) / <alpha-value>)',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease',
        'slide-up': 'slideUp 0.4s ease',
        'float-in': 'floatIn 0.4s ease',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'scale(0.96) translateY(20px)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        floatIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    // `yellow:` = only under the yellow-white theme (<html class="theme-yellow">).
    plugin(({ addVariant }) => addVariant('yellow', '.theme-yellow &')),
  ],
} satisfies Config
