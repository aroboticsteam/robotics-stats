// The server injects `window.__SITE_CONFIG__` (built from environment
// variables) into the page. These defaults are only used by `npm run dev`.
const defaults = {
  title: 'Robotics Stats',
  subtitle: '',
  homeUrl: '',
  homeLabel: 'Home',
  logo: null,
  teams: { VIQRC: [], V5RC: [] },
  defaultProgram: 'VIQRC',
  autoRefreshSeconds: 180,
  footer: { text: `© ${new Date().getFullYear()} Robotics Stats`, secondary: 'VEX Robotics Competition' },
};

export const runtimeConfig = { ...defaults, ...(typeof window !== 'undefined' ? window.__SITE_CONFIG__ : {}) };
