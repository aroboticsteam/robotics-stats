const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

// How long a cached entry is served without triggering a background refresh,
// and the hard KV expiry (entry is dropped and refetched synchronously after this).
// This site shows historical/all-time stats, not live in-competition scoring, so
// TTLs are chosen to keep KV write volume well under the free-tier daily cap
// (1,000 writes/day) rather than to chase near-real-time freshness. The matches
// endpoint is paginated up to 6 pages per team, which multiplies its write count,
// so it gets the same long TTL as everything else instead of a short one.
const TTL_RULES = [
  { pattern: /^\/teams\/\d+\/matches$/, freshTtl: 7200, hardTtl: 604800 },
  { pattern: /^\/events\/[^/]+\/divisions\/[^/]+\/matches$/, freshTtl: 7200, hardTtl: 604800 },
  { pattern: /^\/teams\/\d+\/(skills|rankings|awards|events)$/, freshTtl: 7200, hardTtl: 604800 },
  { pattern: /^\/teams$/, freshTtl: 7200, hardTtl: 604800 },
  { pattern: /^\/seasons/, freshTtl: 21600, hardTtl: 604800 },
  { pattern: /^\/events/, freshTtl: 7200, hardTtl: 604800 }
];
const DEFAULT_TTL = { freshTtl: 1800, hardTtl: 86400 };

function ttlFor(pathname) {
  const rule = TTL_RULES.find((r) => r.pattern.test(pathname));
  return rule || DEFAULT_TTL;
}

function buildCacheKey(targetUrl) {
  return `proxy:${targetUrl.toString()}`;
}

// Per-isolate in-flight request map: collapses concurrent identical requests
// (cold cache stampede, or a revalidation racing a fresh miss) into one upstream call.
const IN_FLIGHT = new Map();

async function fetchUpstream(targetUrl, apiKey) {
  const key = targetUrl.toString();
  if (IN_FLIGHT.has(key)) {
    return IN_FLIGHT.get(key);
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Accept', 'application/json');
  headers.set(
    'User-Agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const promise = fetch(key, { method: 'GET', headers })
    .then(async (response) => ({
      status: response.status,
      body: response.status === 200 ? await response.json() : await response.text()
    }))
    .finally(() => {
      IN_FLIGHT.delete(key);
    });

  IN_FLIGHT.set(key, promise);
  return promise;
}

const MATCHES_PATTERN = /^\/teams\/\d+\/matches$/;
const UPSTREAM_MAX_PER_PAGE = 250; // VEX API's documented maximum
const MAX_MATCH_PAGES = 10; // 2,500 matches - far beyond any team's real history

// A team's full match history is paginated upstream. Caching each page under its
// own key multiplies KV writes by page count every time it goes stale. Instead,
// fetch and merge every page into a single blob cached under one key per team -
// one write per revalidation instead of up to several.
async function fetchAllMatches(targetBase, pathname, keptParams, apiKey) {
  let allData = [];
  let meta = null;

  for (let page = 1; page <= MAX_MATCH_PAGES; page++) {
    const params = new URLSearchParams(keptParams);
    params.set('page', String(page));
    params.set('per_page', String(UPSTREAM_MAX_PER_PAGE));
    const pageUrl = new URL(`${targetBase}${pathname}?${params.toString()}`);

    const result = await fetchUpstream(pageUrl, apiKey);
    if (result.status !== 200) {
      return page === 1 ? result : { status: 200, body: { meta, data: allData } };
    }

    meta = result.body.meta;
    const data = result.body.data || [];
    allData = allData.concat(data);

    const lastPage = meta && meta.last_page ? meta.last_page : page;
    if (page >= lastPage || data.length === 0) break;
  }

  return { status: 200, body: { meta, data: allData } };
}

// Strip page/per_page from a request's query params - the worker always fetches
// and caches the full merged result regardless of what pagination a caller asks
// for, so those params must not fragment the cache key.
function nonPaginationParams(search) {
  const params = new URLSearchParams(search);
  params.delete('page');
  params.delete('per_page');
  return params;
}

async function revalidate(pathname, targetBase, keptParams, apiKey, cache, cacheKey, hardTtl) {
  try {
    const result = MATCHES_PATTERN.test(pathname)
      ? await fetchAllMatches(targetBase, pathname, keptParams, apiKey)
      : await fetchUpstream(new URL(`${targetBase}${pathname}?${keptParams.toString()}`), apiKey);
    if (result.status === 200) {
      await cache.put(
        cacheKey,
        JSON.stringify({ storedAt: Date.now(), data: result.body }),
        { expirationTtl: hardTtl }
      );
    }
  } catch {
    // Stale data already served; a future request will retry.
  }
}

async function handleProxyRequest(request, env, ctx) {
  const url = new URL(request.url);
  const targetBase = env.VEX_API_BASE_URL || 'https://events.vex.com/api/v2';
  const apiKey = env.VEX_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Proxy misconfigured: VEX_API_KEY secret is not set' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  let pathname = url.pathname;
  if (pathname.startsWith('/v1/vex')) {
    pathname = pathname.replace(/^\/v1\/vex/, '');
  } else if (pathname.startsWith('/api/v2')) {
    pathname = pathname.replace(/^\/api\/v2/, '');
  }
  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  const isMatches = MATCHES_PATTERN.test(pathname);
  const keptParams = isMatches ? nonPaginationParams(url.search) : new URLSearchParams(url.search);
  const targetUrl = new URL(`${targetBase}${pathname}?${keptParams.toString()}`);
  const cacheKey = buildCacheKey(targetUrl);
  const { freshTtl, hardTtl } = ttlFor(pathname);
  const cache = env.PROXY_CACHE;

  if (request.method === 'GET') {
    const cached = await cache.get(cacheKey, { type: 'json' });
    if (cached) {
      const age = (Date.now() - cached.storedAt) / 1000;
      if (age > freshTtl) {
        ctx.waitUntil(revalidate(pathname, targetBase, keptParams, apiKey, cache, cacheKey, hardTtl));
      }
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${freshTtl}`,
          'X-Proxy-Cache': age > freshTtl ? 'KV_STALE' : 'KV_HIT',
          'Age': String(Math.floor(age)),
          ...CORS_HEADERS
        }
      });
    }
  }

  try {
    const result = isMatches
      ? await fetchAllMatches(targetBase, pathname, keptParams, apiKey)
      : await fetchUpstream(targetUrl, apiKey);

    if (result.status === 429 || result.status === 403) {
      const stale = await cache.get(cacheKey, { type: 'json' });
      if (stale) {
        return new Response(JSON.stringify(stale.data), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Proxy-Cache': 'STALE_KV_FALLBACK',
            ...CORS_HEADERS
          }
        });
      }
      return new Response(
        JSON.stringify({
          error: 'Upstream VEX API Rate Limited',
          details: String(result.body).slice(0, 200),
          status: result.status
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '5', ...CORS_HEADERS }
        }
      );
    }

    if (result.status === 200) {
      if (request.method === 'GET') {
        ctx.waitUntil(
          cache.put(
            cacheKey,
            JSON.stringify({ storedAt: Date.now(), data: result.body }),
            { expirationTtl: hardTtl }
          )
        );
      }

      return new Response(JSON.stringify(result.body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${freshTtl}`,
          'X-Proxy-Cache': 'MISS',
          ...CORS_HEADERS
        }
      });
    }

    return new Response(String(result.body), {
      status: result.status,
      headers: { ...CORS_HEADERS }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'VEX Proxy Gateway Error', message: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    return handleProxyRequest(request, env, ctx);
  }
};
