// Brand theme shared by robotics-home and robotics-stats (keep the two copies identical).
//
// Every colour, the heading font and the colour-scheme mode come from environment variables; the defaults
// are the QE brand (navy, gold, Space Grotesk), matching the TMTools team site. The result is a block of CSS
// custom properties injected into the page, which Tailwind (tailwind.config.js) reads. Colours are stored
// as "r g b" triples so Tailwind's opacity modifiers keep working.
//
//   THEME_MODE                auto (default: dark, light when the visitor's system prefers it) | dark | light
//   THEME_<TOKEN>             dark palette, e.g. THEME_BG=#000E23
//   THEME_LIGHT_<TOKEN>       light palette, e.g. THEME_LIGHT_BG=#F2F4F7
//   IQ_COLOR, V5_COLOR        programme colours (VEX IQ / V5)
//   FONT_HEADING              heading font family (default "Space Grotesk")
//   FONT_HEADING_URL          woff2 for it (default /fonts/space-grotesk.woff2, shipped in the image); "" = none
//   ACCENT_COLOR, BACKGROUND_COLOR, PANEL_COLOR   older names for THEME_ACCENT / THEME_BG / THEME_CARD
//
// TOKEN is one of: BG BG2 CARD RAISE LINE INK MUTED ACCENT LINK OK RED BLUE
const env = process.env;

const fail = (msg) => {
  console.error(`[config] ${msg}`);
  process.exit(1);
};
const str = (name, fallback = '') => (env[name] !== undefined && env[name] !== '' ? env[name] : fallback);
const hex = (name, fallback) => {
  const v = str(name, fallback);
  if (!/^#?[0-9a-f]{6}$/i.test(v)) fail(`${name} must be a 6-digit hex colour (got "${v}")`);
  return '#' + v.replace('#', '').toUpperCase();
};
const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => toRgb(a).map((c, i) => Math.round(c + (toRgb(b)[i] - c) * t));
const triple = (c) => (typeof c === 'string' ? toRgb(c) : c).join(' ');

const DARK = {
  BG: '#000E23', BG2: '#04162E', CARD: '#071A35', RAISE: '#0D2342', LINE: '#1B3050',
  INK: '#EEF1F6', MUTED: '#92A3BD', ACCENT: '#C9B98E', LINK: '#5CC0DA', OK: '#5FD29A', RED: '#EE8DA0', BLUE: '#7CBDF0',
};
const LIGHT = {
  BG: '#F2F4F7', BG2: '#E9ECF1', CARD: '#FFFFFF', RAISE: '#EEF1F5', LINE: '#D8DDE6',
  INK: '#000E23', MUTED: '#4B586D', ACCENT: '#6E5F3A', LINK: '#0C6F8C', OK: '#17704A', RED: '#9A2339', BLUE: '#1D418E',
};
const LEGACY = { ACCENT: 'ACCENT_COLOR', BG: 'BACKGROUND_COLOR', CARD: 'PANEL_COLOR' };

const mode = str('THEME_MODE', 'auto').toLowerCase();
if (!['auto', 'dark', 'light'].includes(mode)) fail('THEME_MODE must be auto, dark or light');

function palette(defaults, prefix) {
  const out = {};
  for (const [token, fallback] of Object.entries(defaults)) {
    const legacy = prefix === 'THEME_' && LEGACY[token] ? str(LEGACY[token]) : '';
    out[token] = hex(`${prefix}${token}`, legacy || fallback);
  }
  return out;
}

function vars(p) {
  const v = {
    bg: p.BG, 'bg-2': p.BG2, card: p.CARD, raise: p.RAISE, line: p.LINE, ink: p.INK, muted: p.MUTED,
    accent: p.ACCENT, 'accent-light': mix(p.ACCENT, p.INK, 0.35), 'accent-hover': mix(p.ACCENT, p.INK, 0.15),
    link: p.LINK, ok: p.OK, red: p.RED, blue: p.BLUE,
    // Tailwind's slate scale, remapped onto the palette so the app's existing slate-* classes follow the brand
    // (and flip in light mode): 950 page, 900 card, 800 raised, 700 line, 400 muted, 100 ink.
    's-950': p.BG, 's-900': p.CARD, 's-800': p.RAISE, 's-700': p.LINE,
    's-600': mix(p.LINE, p.MUTED, 0.35), 's-500': mix(p.LINE, p.MUTED, 0.7), 's-400': p.MUTED,
    's-300': mix(p.MUTED, p.INK, 0.45), 's-200': mix(p.MUTED, p.INK, 0.75), 's-100': p.INK, 's-50': p.INK,
  };
  return Object.entries(v).map(([k, c]) => `--${k}:${triple(c)}`).join(';');
}

const dark = palette(DARK, 'THEME_');
const light = palette(LIGHT, 'THEME_LIGHT_');
const iq = hex('IQ_COLOR', '#0C7C9D');
const v5 = hex('V5_COLOR', '#9A2339');
const heading = str('FONT_HEADING', 'Space Grotesk').replace(/["';{}<]/g, '');
const headingUrl = env.FONT_HEADING_URL === undefined ? '/fonts/space-grotesk.woff2' : env.FONT_HEADING_URL;

const fixed = `--iq:${triple(iq)};--v5:${triple(v5)};--font-heading:"${heading}",system-ui,-apple-system,"Segoe UI",sans-serif`;
const css = [
  headingUrl
    ? `@font-face{font-family:"${heading}";font-style:normal;font-weight:500 700;font-display:swap;src:url("${headingUrl.replace(/["<]/g, '')}") format("woff2")}`
    : '',
  `:root{${vars(mode === 'light' ? light : dark)};${fixed};color-scheme:${mode === 'light' ? 'light' : 'dark'}}`,
  mode === 'auto' ? `@media (prefers-color-scheme: light){:root{${vars(light)};color-scheme:light}}` : '',
].join('');

export const themeCss = css;
export const themeColor = mode === 'light' ? light.BG : dark.BG;
export const colorScheme = mode === 'auto' ? 'dark light' : mode;
