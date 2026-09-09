const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

// How long a cached entry is served without triggering a background refresh,
// and the hard KV expiry (entry is dropped and refetched synchronously after this).
// Slow-changing data (season/team metadata, historical skills/rankings/awards) gets
// long TTLs; match data during live events gets a short one.
const TTL_RULES = [
  { pattern: /^\/teams\/\d+\/matches$/, freshTtl: 300, hardTtl: 86400 },
  { pattern: /^\/events\/[^/]+\/divisions\/[^/]+\/matches$/, freshTtl: 180, hardTtl: 86400 },
  { pattern: /^\/teams\/\d+\/(skills|rankings|awards|events)$/, freshTtl: 3600, hardTtl: 604800 },
  { pattern: /^\/teams$/, freshTtl: 3600, hardTtl: 604800 },
  { pattern: /^\/seasons/, freshTtl: 21600, hardTtl: 604800 },
  { pattern: /^\/events/, freshTtl: 3600, hardTtl: 604800 }
];
const DEFAULT_TTL = { freshTtl: 600, hardTtl: 86400 };

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

async function revalidate(targetUrl, apiKey, cache, cacheKey, hardTtl) {
  try {
    const result = await fetchUpstream(targetUrl, apiKey);
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

  const targetUrl = new URL(`${targetBase}${pathname}${url.search}`);
  const cacheKey = buildCacheKey(targetUrl);
  const { freshTtl, hardTtl } = ttlFor(pathname);
  const cache = env.PROXY_CACHE;

  if (request.method === 'GET') {
    const cached = await cache.get(cacheKey, { type: 'json' });
    if (cached) {
      const age = (Date.now() - cached.storedAt) / 1000;
      if (age > freshTtl) {
        ctx.waitUntil(revalidate(targetUrl, apiKey, cache, cacheKey, hardTtl));
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
    const result = await fetchUpstream(targetUrl, apiKey);

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
