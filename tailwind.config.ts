import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Countdown Kinetic — Stitch Design System
        'background': '#0f1417',
        'on-background': '#dfe3e7',
        'primary-fixed-dim': '#00daf3',
        'primary-fixed': '#9cf0ff',
        'primary-container': '#00e5ff',
        'primary': '#c3f5ff',
        'on-primary': '#00363d',
        'on-primary-container': '#00626e',
        'secondary': '#b6c4ff',
        'secondary-container': '#0050ee',
        'on-secondary': '#002780',
        'on-secondary-container': '#d4dbff',
        'secondary-fixed-dim': '#b6c4ff',
        'secondary-fixed': '#dce1ff',
        'tertiary': '#e6edff',
        'tertiary-container': '#c3d1ef',
        'on-tertiary': '#233148',
        'tertiary-fixed-dim': '#b9c7e4',
        'tertiary-fixed': '#d6e3ff',
        'error': '#ffb4ab',
        'error-container': '#93000a',
        'on-error': '#690005',
        'on-error-container': '#ffdad6',
        
        'surface': '#0f1417',
        'surface-dim': '#0f1417',
        'surface-bright': '#353a3d',
        'surface-container': '#1b2023',
        'surface-container-lowest': '#0a0f12',
        'surface-container-low': '#171c1f',
        'surface-container-high': '#262b2e',
        'surface-container-highest': '#313539',
        'surface-variant': '#313539',
        'on-surface': '#dfe3e7',
        'on-surface-variant': '#bac9cc',
        'outline': '#849396',
        'outline-variant': '#3b494c',
        'outline-var': '#3d4a3d',
        'surface-tint': '#00daf3',
      },
      fontFamily: {
        'inter': ['Inter', 'sans-serif'],
        'mono': ['"JetBrains Mono"', 'monospace'],
        'body-md': ['Inter', 'sans-serif'],
        'headline-xl': ['Inter', 'sans-serif'],
        'label-caps': ['Inter', 'sans-serif'],
        'headline-lg-mobile': ['Inter', 'sans-serif'],
        'body-sm': ['Inter', 'sans-serif'],
        'headline-lg': ['Inter', 'sans-serif'],
        'mono-metric': ['Inter', 'monospace'],
      },
      fontSize: {
        // Stitch
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'headline-xl': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'label-caps': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '600' }],
        'headline-lg-mobile': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'mono-metric': ['18px', { lineHeight: '24px', fontWeight: '500' }],
        
        // Previous configs
        'timer': ['72px', { lineHeight: '72px', letterSpacing: '-0.04em', fontWeight: '800' }],
        'hl-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'tile': ['28px', { lineHeight: '28px', fontWeight: '600' }],
        'label': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '500' }],
      },
      borderRadius: {
        'tile': '1rem',
        'pill': '9999px',
        // Stitch
        'DEFAULT': '0.125rem',
        'lg': '0.25rem',
        'xl': '0.5rem',
        'full': '0.75rem',
      },
      spacing: {
        // Stitch
        'stack-lg': '24px',
        'container-margin': '24px',
        'gutter': '16px',
        'stack-md': '12px',
        'base': '8px',
        'stack-sm': '4px',
      },
      boxShadow: {
        'glow-green': '0 0 16px 4px rgba(75, 226, 119, 0.35)',
        'glow-indigo': '0 0 16px 6px rgba(99, 102, 241, 0.40)',
        'glow-rose': '0 0 16px 6px rgba(255, 136, 146, 0.40)',
        'tile-active': '0 0 0 2px #4be277, 0 0 20px 4px rgba(75,226,119,0.35)',
        'card': '0 4px 6px rgba(0,0,0,0.4)',
        // Stitch custom glows
        'neon-glow': '0 0 15px rgba(0, 229, 255, 0.4), inset 0 0 10px rgba(0, 229, 255, 0.1)',
        'glow-active': 'inset 0 0 10px rgba(0, 229, 255, 0.5)',
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'slide-in-top': 'slideInTop 0.3s ease-out',
        'timer-shrink': 'timerShrink 30s linear forwards',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 8px 2px rgba(75,226,119,0.2)' },
          '50%': { boxShadow: '0 0 20px 6px rgba(75,226,119,0.5)' },
        },
        slideInTop: {
          from: { transform: 'translateY(-100%)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        timerShrink: {
          from: { width: '100%' },
          to: { width: '0%' },
        },
      },
      backdropBlur: {
        'glass': '12px',
      },
    },
  },
  plugins: [],
}

export default config
