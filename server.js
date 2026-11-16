// Zero-dependency production server for robotics-stats.
//  - serves the built SPA from ./dist with env-driven configuration injected
//  - runs the VEX Robotics Events API proxy locally at /api/vex/* (adds the API
//    key, merges paginated results, caches responses in memory)
// See README.md for the full list of environment variables.
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeCss, themeColor, colorScheme } from './theme.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const env = process.env;

// ---------------------------------------------------------------- helpers
const fail = (msg) => {
  console.error(`[config] ${msg}`);
  process.exit(1);
};
const str = (name, fallback = '') => (env[name] !== undefined && env[name] !== '' ? env[name] : fallback);
const bool = (name, fallback) => {
  const v = str(name);
  return v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);
};
const int = (name, fallback) => {
  const n = Number(str(name, String(fallback)));
  return Number.isFinite(n) && n >= 0 ? n : fail(`${name} must be a non-negative number`);
};
const teamList = (name) => str(name).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);

// ----------------------------------------------------------------- config
const year = new Date().getFullYear();
const title = str('SITE_TITLE', 'Robotics Stats');
const defaultProgram = str('DEFAULT_PROGRAM', 'VIQRC').toUpperCase();
if (!['VIQRC', 'V5RC'].includes(defaultProgram)) fail('DEFAULT_PROGRAM must be VIQRC or V5RC');


const siteConfig = {
  title,
  subtitle: str('SITE_SUBTITLE', 'Performance benchmarks, robot skills rankings, tournament awards, and match telemetry.'),
  homeUrl: str('HOME_URL'),
  homeLabel: str('HOME_LABEL', 'Home'),
  logo: str('LOGO_URL')
    ? { src: str('LOGO_URL'), alt: str('LOGO_ALT', `${title} logo`), href: str('LOGO_HREF'), whiteBg: bool('LOGO_WHITE_BG', true) }
    : null,
  teams: { VIQRC: teamList('TEAMS_VIQRC'), V5RC: teamList('TEAMS_V5RC') },
  defaultProgram,
  autoRefreshSeconds: int('AUTO_REFRESH_SECONDS', 180),
  footer: {
    text: str('FOOTER_TEXT', `© ${year} ${title}`),
    secondary: str('FOOTER_SECONDARY_TEXT', 'VEX Robotics Competition'),
  },
};


const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const inlineJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

const favicon = str('FAVICON_URL') || (siteConfig.logo ? siteConfig.logo.src : '');
const runtimeHead = [
  `<title>${esc(title)}</title>`,
  `<meta name="color-scheme" content="${colorScheme}" />`,
  `<meta name="theme-color" content="${themeColor}" />`,
  favicon ? `<link rel="icon" href="${esc(favicon)}" />` : '',
  `<style>${themeCss}</style>`,
  `<script>window.__SITE_CONFIG__=${inlineJson(siteConfig)};</script>`,
].join('\n    ');

const baseHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

// -------------------------------------------------------- VEX API proxy
const VEX_API_KEY = str('VEX_API_KEY');
const VEX_BASE = str('VEX_API_BASE_URL', 'https://events.vex.com/api/v2').replace(/\/+$/, '');
const VEX_UA = str(
  'VEX_USER_AGENT',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
);
if (!VEX_API_KEY) {
  console.warn('[config] VEX_API_KEY is not set - /api/vex will return 500 until it is provided');
}

// Fresh entries are served as-is; stale ones are served immediately and
// refreshed in the background; entries older than MAX_AGE are dropped.
const FRESH_MS = int('CACHE_FRESH_SECONDS', 7200) * 1000;
const MAX_AGE_MS = int('CACHE_MAX_AGE_SECONDS', 604800) * 1000;
const MAX_ENTRIES = int('CACHE_MAX_ENTRIES', 2000);
const UPSTREAM_CONCURRENCY = Math.max(1, int('UPSTREAM_CONCURRENCY', 4));

const ALLOWED_PATH = /^\/(seasons|teams|events|programs)(\/[A-Za-z0-9_-]+)*\/?$/;
// Per-team endpoints are fetched in full (all upstream pages merged) and
// cached as a single entry, so clients never need to paginate.
const AGGREGATED = /^\/teams\/\d+\/(matches|skills|rankings|awards|events)$/;
const UPSTREAM_PER_PAGE = 250;
const MAX_PAGES = 10;

const cache = new Map(); // key -> { storedAt, data }
const inFlight = new Map(); // url -> Promise<{status, body}>
let active = 0;
const waiting = [];

const freshFor = (pathname) => (pathname.startsWith('/seasons') ? FRESH_MS * 3 : FRESH_MS);

async function limited(task) {
  if (active >= UPSTREAM_CONCURRENCY) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function fetchUpstream(url) {
  if (inFlight.has(url)) return inFlight.get(url);
  const p = limited(async () => {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${VEX_API_KEY}`, Accept: 'application/json', 'User-Agent': VEX_UA },
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    return { status: r.status, body: r.status === 200 ? JSON.parse(text) : text, retryAfter: r.headers.get('retry-after') };
  }).finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}

async function fetchAllPages(pathname, params) {
  let all = [];
  let meta = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams(params);
    q.set('page', String(page));
    q.set('per_page', String(UPSTREAM_PER_PAGE));
    const r = await fetchUpstream(`${VEX_BASE}${pathname}?${q}`);
    if (r.status !== 200) return page === 1 ? r : { status: 200, body: { meta, data: all } };
    meta = r.body.meta;
    const data = r.body.data || [];
    all = all.concat(data);
    if (page >= (meta?.last_page || page) || data.length === 0) break;
  }
  return { status: 200, body: { meta, data: all } };
}

const fetchResource = (pathname, params) =>
  AGGREGATED.test(pathname) ? fetchAllPages(pathname, params) : fetchUpstream(`${VEX_BASE}${pathname}?${params}`);

// ------------------------------------------------- optional Redis cache
// Minimal RESP client (no npm dependency). Enabled with REDIS_URL
// (redis:// or rediss://). Lets several replicas share one cache and
// coordinate background refreshes. Always fails open: when Redis is
// unreachable the in-memory cache is used instead.
class Redis {
  constructor(url) {
    const u = new URL(url);
    this.tls = u.protocol === 'rediss:';
    this.host = u.hostname;
    this.port = Number(u.port || 6379);
    this.username = decodeURIComponent(u.username || '');
    this.password = decodeURIComponent(u.password || '');
    this.db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
    this.queue = [];
    this.buf = Buffer.alloc(0);
    this.sock = null;
    this.ready = false;
    this.closed = false;
    this.backoff = 500;
    this.connect();
  }

  connect() {
    const opts = { host: this.host, port: this.port };
    const sock = this.tls ? tls.connect({ ...opts, servername: this.host }) : net.connect(opts);
    this.sock = sock;
    sock.setKeepAlive(true, 15000);
    sock.on(this.tls ? 'secureConnect' : 'connect', async () => {
      try {
        if (this.password) await this.raw(this.username ? ['AUTH', this.username, this.password] : ['AUTH', this.password]);
        if (this.db) await this.raw(['SELECT', String(this.db)]);
        this.ready = true;
        this.backoff = 500;
        console.log(`[redis] connected to ${this.host}:${this.port}`);
      } catch (e) {
        console.error('[redis] handshake failed:', e.message);
        sock.destroy();
      }
    });
    sock.on('data', (d) => this.onData(d));
    sock.on('error', () => {});
    sock.on('close', () => {
      if (this.ready) console.warn('[redis] connection lost, using in-memory cache until it returns');
      this.ready = false;
      for (const p of this.queue.splice(0)) p.reject(new Error('redis connection closed'));
      this.buf = Buffer.alloc(0);
      if (this.closed) return;
      setTimeout(() => this.connect(), this.backoff).unref();
      this.backoff = Math.min(this.backoff * 2, 10000);
    });
  }

  raw(args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('redis timeout')), 2000);
      this.queue.push({
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      let out = `*${args.length}\r\n`;
      for (const a of args) out += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
      this.sock.write(out);
    });
  }

  cmd(args) {
    return this.ready ? this.raw(args) : Promise.reject(new Error('redis not ready'));
  }

  // Parse one reply at `pos`; returns [value, nextPos], or null if incomplete.
  parse(buf, pos) {
    const eol = buf.indexOf('\r\n', pos);
    if (eol === -1) return null;
    const type = String.fromCharCode(buf[pos]);
    const line = buf.toString('utf8', pos + 1, eol);
    const next = eol + 2;
    if (type === '+') return [line, next];
    if (type === '-') return [new Error(line), next];
    if (type === ':') return [Number(line), next];
    if (type === '$') {
      const len = Number(line);
      if (len === -1) return [null, next];
      if (buf.length < next + len + 2) return null;
      return [buf.toString('utf8', next, next + len), next + len + 2];
    }
    return [new Error(`unsupported reply type ${type}`), next];
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    let pos = 0;
    while (this.queue.length) {
      const r = this.parse(this.buf, pos);
      if (!r) break;
      pos = r[1];
      const p = this.queue.shift();
      r[0] instanceof Error ? p.reject(r[0]) : p.resolve(r[0]);
    }
    this.buf = this.buf.subarray(pos);
  }

  close() {
    this.closed = true;
    this.sock?.destroy();
  }
}

const REDIS_PREFIX = str('REDIS_PREFIX', 'robotics-stats:');
const redis = str('REDIS_URL') ? new Redis(str('REDIS_URL')) : null;

async function cacheGet(key) {
  if (redis?.ready) {
    try {
      const raw = await redis.cmd(['GET', REDIS_PREFIX + key]);
      return raw ? JSON.parse(raw) : null;
    } catch {
      /* fall back to memory */
    }
  }
  return cache.get(key) || null;
}

async function cacheSet(key, data) {
  const entry = { storedAt: Date.now(), data };
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  if (redis?.ready) {
    try {
      await redis.cmd(['SET', REDIS_PREFIX + key, JSON.stringify(entry), 'EX', String(Math.ceil(MAX_AGE_MS / 1000))]);
    } catch {
      /* memory copy already stored */
    }
  }
}

// Only one replica refreshes a stale entry at a time (best effort).
async function acquireRefresh(key) {
  if (!redis?.ready) return true;
  try {
    return (await redis.cmd(['SET', `${REDIS_PREFIX}lock:${key}`, '1', 'NX', 'EX', '60'])) === 'OK';
  } catch {
    return true;
  }
}

function sendJson(res, status, obj, extra = {}) {
  res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(obj));
}

async function handleProxy(req, res, pathname, query) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
  }
  if (!VEX_API_KEY) return sendJson(res, 500, { error: 'Proxy misconfigured: VEX_API_KEY is not set' });
  if (!ALLOWED_PATH.test(pathname)) return sendJson(res, 404, { error: 'Unsupported VEX API path' });

  const params = new URLSearchParams(query);
  if (AGGREGATED.test(pathname)) {
    params.delete('page');
    params.delete('per_page');
  }
  params.sort();
  const key = `${pathname}?${params}`;
  const fresh = freshFor(pathname);
  const hit = await cacheGet(key);
  const age = hit ? Date.now() - hit.storedAt : Infinity;

  const reply = (data, state, ageMs = 0) =>
    sendJson(res, 200, data, {
      'Cache-Control': `public, max-age=${Math.floor(fresh / 1000)}`,
      'X-Proxy-Cache': state,
      Age: String(Math.floor(ageMs / 1000)),
    });

  if (hit && age < MAX_AGE_MS) {
    if (age > fresh) {
      acquireRefresh(key).then((ok) => {
        if (!ok) return;
        fetchResource(pathname, params)
          .then((r) => r.status === 200 && cacheSet(key, r.body))
          .catch(() => {});
      });
      return reply(hit.data, 'STALE', age);
    }
    return reply(hit.data, 'HIT', age);
  }

  try {
    const r = await fetchResource(pathname, params);
    if (r.status === 200) {
      cacheSet(key, r.body);
      return reply(r.body, 'MISS');
    }
    if ((r.status === 429 || r.status === 403) && hit) return reply(hit.data, 'STALE_FALLBACK', age);
    if (r.status === 429) {
      return sendJson(res, 429, { error: 'Upstream VEX API rate limited' }, { 'Retry-After': r.retryAfter || '5' });
    }
    return sendJson(res, r.status, { error: 'Upstream VEX API error', status: r.status, details: String(r.body).slice(0, 200) });
  } catch (err) {
    if (hit) return reply(hit.data, 'STALE_FALLBACK', age);
    return sendJson(res, 502, { error: 'VEX proxy gateway error', message: err.message });
  }
}

// ----------------------------------------------------------------- static
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const indexTemplate = fs.existsSync(path.join(DIST, 'index.html'))
  ? fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  : fail('dist/index.html not found - run "npm run build" first');
const indexHtml = indexTemplate.replace('<!--RUNTIME_HEAD-->', runtimeHead);

// Optional directory (e.g. a mounted volume) served at /media/ for logos/images.
const MEDIA_DIR = path.resolve(str('MEDIA_DIR', '/media'));

function notFound(res) {
  res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function sendFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function sendIndex(req, res) {
  res.writeHead(200, { ...baseHeaders, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : indexHtml);
}

function resolveWithin(dir, rel) {
  const file = path.join(dir, rel);
  return file === dir || file.startsWith(dir + path.sep) ? file : null;
}

const server = http
  .createServer((req, res) => {
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://x');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound(res);
    }

    if (pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (pathname === '/api/vex' || pathname.startsWith('/api/vex/')) {
      return handleProxy(req, res, pathname.slice('/api/vex'.length) || '/', url.searchParams);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    if (pathname === '/' || pathname === '/index.html') return sendIndex(req, res);

    if (pathname.startsWith('/media/')) {
      const file = resolveWithin(MEDIA_DIR, pathname.slice('/media/'.length));
      return file ? sendFile(req, res, file, 'public, max-age=3600') : notFound(res);
    }

    const file = resolveWithin(DIST, pathname.slice(1));
    if (!file) return notFound(res);
    if (path.extname(pathname)) {
      return sendFile(req, res, file, pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    }
    return sendIndex(req, res); // SPA fallback (/viqrc/curr, /v5rc/all, ...)
  })
  .listen(Number(str('PORT', '8080')), '0.0.0.0', () => {
    console.log(`robotics-stats listening on :${str('PORT', '8080')}`);
  });

// Graceful shutdown so rolling updates / scale-down don't drop requests.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => {
      redis?.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
