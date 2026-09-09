const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

const KV_TTL_SECONDS = 600; // 10 minutes

function buildCacheKey(targetUrl) {
  return `proxy:${targetUrl.toString()}`;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

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

    if (request.method === 'GET') {
      const cached = await env.PROXY_CACHE.get(cacheKey, { type: 'json' });
      if (cached) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${KV_TTL_SECONDS}`,
            'X-Proxy-Cache': 'KV_HIT',
            ...CORS_HEADERS
          }
        });
      }
    }

    const upstreamHeaders = new Headers();
    upstreamHeaders.set('Authorization', `Bearer ${apiKey}`);
    upstreamHeaders.set('Accept', 'application/json');
    upstreamHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    try {
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: upstreamHeaders
      });

      if (response.status === 429 || response.status === 403) {
        const stale = await env.PROXY_CACHE.get(cacheKey, { type: 'json' });
        if (stale) {
          return new Response(JSON.stringify(stale), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Proxy-Cache': 'STALE_KV_FALLBACK',
              ...CORS_HEADERS
            }
          });
        }
        const errText = await response.text();
        return new Response(
          JSON.stringify({
            error: 'Upstream VEX API Rate Limited',
            details: errText.slice(0, 200),
            status: response.status
          }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '5', ...CORS_HEADERS }
          }
        );
      }

      if (response.status === 200) {
        const data = await response.json();

        if (request.method === 'GET') {
          ctx.waitUntil(
            env.PROXY_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: KV_TTL_SECONDS })
          );
        }

        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${KV_TTL_SECONDS}`,
            'X-Proxy-Cache': 'MISS',
            ...CORS_HEADERS
          }
        });
      }

      return new Response(response.body, {
        status: response.status,
        headers: { ...CORS_HEADERS }
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'VEX Proxy Gateway Error', message: err.message }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
  }
};
