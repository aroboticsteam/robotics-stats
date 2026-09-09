# qerobotics-stats

Monorepo:

- [`web/`](web) — React/Vite frontend, deployed to Cloudflare Pages.
- [`api/`](api) — Cloudflare Worker that proxies and caches the VEX Robotics Events API.

## web

```bash
cd web
npm install
npm run dev
```

## api

Cloudflare Worker (`api/src/index.js`) that proxies requests to `https://events.vex.com/api/v2`
and caches GET responses in Workers KV for 10 minutes.

```bash
cd api
npm install
wrangler kv namespace create PROXY_CACHE          # once, then fill in wrangler.toml
wrangler kv namespace create PROXY_CACHE --preview
wrangler secret put VEX_API_KEY
npm run dev
npm run deploy
```

## CI/CD

Two GitHub Actions workflows deploy each app independently on push to `main`, scoped by path:

- `.github/workflows/deploy-web.yml` — builds `web/` and deploys to Cloudflare Pages.
- `.github/workflows/deploy-api.yml` — deploys `api/` as a Cloudflare Worker.

Both need these repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
