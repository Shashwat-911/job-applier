/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5b8fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        surface: {
          DEFAULT: '#0f0f1a',
          50:  '#f8f8fc',
          100: '#1a1a2e',
          200: '#16213e',
          300: '#0f3460',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-in':   'slideIn 0.3s ease-out',
        'pulse-dot':  'pulseDot 1.5s ease-in-out infinite',
        'gradient':   'gradientShift 4s ease infinite',
      },
      keyframes: {
        fadeIn:        { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideIn:       { from: { opacity: 0, transform: 'translateX(-12px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        pulseDot:      { '0%,100%': { transform: 'scale(1)', opacity: 1 }, '50%': { transform: 'scale(1.4)', opacity: 0.7 } },
        gradientShift: { '0%,100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
      },
    },
  },
  plugins: [],
};
