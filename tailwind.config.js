const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const slate = Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, rgb(`s-${n}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Runtime-themable: theme.js turns the THEME_* env vars into these CSS variables (light + dark).
        surface: rgb('bg'),
        panel: { DEFAULT: rgb('card'), 2: rgb('raise'), 3: rgb('line') },
        accent: { DEFAULT: rgb('accent'), light: rgb('accent-light'), hover: rgb('accent-hover') },
        ink: rgb('ink'),
        muted: rgb('muted'),
        line: rgb('line'),
        link: rgb('link'),
        ok: rgb('ok'),
        red: rgb('red'),
        blue: rgb('blue'),
        iq: rgb('iq'),
        v5: rgb('v5'),
        // The app's slate-* classes follow the palette too (and flip in light mode).
        slate,
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        heading: ['var(--font-heading)'],
      },
    },
  },
  plugins: [],
};
