const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Runtime-themable (set from env by the server as CSS variables)
        accent: { DEFAULT: rgb('accent'), light: rgb('accent-light'), hover: rgb('accent-hover') },
        surface: rgb('surface'),
        panel: { DEFAULT: rgb('panel'), 2: rgb('panel-2'), 3: rgb('panel-3') },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
