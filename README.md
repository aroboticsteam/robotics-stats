# robotics-stats

VEX IQ / V5 team performance leaderboards (skills, rankings, awards, match
records) shipped as a single Docker image. The container serves the UI **and
runs the VEX API proxy locally** (`/api/vex/*`), so the only external
dependency is the VEX/RobotEvents API itself. Everything else is configured via
environment variables; nothing is team-specific.

## Run

```bash
cp .env.example .env     # set VEX_API_KEY and TEAMS_*
docker compose up --build
# -> http://localhost:8081   (/viqrc/curr, /viqrc/all, /v5rc/curr, /v5rc/all)
```

```bash
docker build -t robotics-stats .
docker run --rm -p 8081:8080 -e VEX_API_KEY=... -e TEAMS_VIQRC=1234A,1234B -e TEAMS_V5RC=1234C robotics-stats
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `VEX_API_KEY` | **required** | RobotEvents API token (kept server-side, never sent to browsers) |
| `TEAMS_VIQRC`, `TEAMS_V5RC` | _(empty)_ | Comma-separated team numbers per program |
| `DEFAULT_PROGRAM` | `VIQRC` | Program shown at `/` (`VIQRC` or `V5RC`) |
| `SITE_TITLE`, `SITE_SUBTITLE` | `Robotics Stats`, generic | Header text |
| `LOGO_URL`, `LOGO_ALT`, `LOGO_HREF`, `LOGO_WHITE_BG` | _(none)_, `true` | Header logo (URL or `/media/<file>`) |
| `FAVICON_URL` | logo | Favicon |
| `HOME_URL`, `HOME_LABEL` | _(hidden)_, `Home` | Top-left link back to e.g. robotics-home |
| `FOOTER_TEXT`, `FOOTER_SECONDARY_TEXT` | `© <year> <title>`, `VEX Robotics Competition` | Footer |
| `THEME_MODE` | `auto` | `auto` (dark, light when the visitor's system prefers it), `dark` or `light` |
| `THEME_<TOKEN>` | configurable brand (navy) | Dark palette, 6-digit hex. `<TOKEN>` is `BG` `BG2` `CARD` `RAISE` `LINE` `INK` `MUTED` `ACCENT` `LINK` `OK` `RED` `BLUE`, e.g. `THEME_BG=#0F172A` |
| `THEME_LIGHT_<TOKEN>` | configurable brand (light) | Same tokens for the light palette, e.g. `THEME_LIGHT_BG=#F1F5F9` |
| `IQ_COLOR`, `V5_COLOR` | `#0891B2`, `#DC2626` | Programme colours (VEX IQ, V5) |
| `FONT_HEADING`, `FONT_HEADING_URL` | `system font`, `/fonts/heading-font.woff2` | Heading font and its woff2 (shipped in the image; set the URL to an empty value to use the system font) |
| `ACCENT_COLOR`, `BACKGROUND_COLOR`, `PANEL_COLOR` | _(unset)_ | Older names for `THEME_ACCENT`, `THEME_BG`, `THEME_CARD` (dark palette) |
| `AUTO_REFRESH_SECONDS` | `180` | Browser refresh interval |
| `CACHE_FRESH_SECONDS` | `7200` | Proxy serves entries this old without refreshing (seasons: 3x) |
| `CACHE_MAX_AGE_SECONDS` | `604800` | Entries older than this are dropped; stale entries are served while refreshing |
| `CACHE_MAX_ENTRIES` | `2000` | In-memory cache size bound |
| `UPSTREAM_CONCURRENCY` | `4` | Max simultaneous requests per replica to the VEX API |
| `REDIS_URL` | _(unset)_ | Optional shared cache, `redis://[:password@]host:port[/db]` or `rediss://` |
| `REDIS_PREFIX` | `robotics-stats:` | Key prefix |
| `VEX_API_BASE_URL`, `VEX_USER_AGENT` | VEX events API v2, browser UA | Upstream overrides |
| `MEDIA_DIR` | `/media` | Directory served at `/media/` (mount a volume for local logos) |
| `PORT` | `8080` | Listen port |

## Proxy

`GET /api/vex/<seasons|teams|events|programs>/...` is forwarded to the VEX API
with the key attached. Only `GET` and those paths are allowed. Per-team
endpoints (`skills`, `rankings`, `awards`, `matches`, `events`) are fetched
across all upstream pages and merged into one cached response. Concurrent
identical requests are collapsed, upstream concurrency is capped, and on
429/403/errors the last cached copy is served. The `X-Proxy-Cache` response
header reports `HIT`, `MISS`, `STALE` or `STALE_FALLBACK`.

## Scaling and Redis

Replicas are stateless, so run as many as you need behind a load balancer
(`GET /healthz` for health checks; the server drains on `SIGTERM`).

Without `REDIS_URL` each replica keeps its own in-memory cache, so every
replica hits the VEX API for each cold entry. Set `REDIS_URL` and all replicas
share one cache, and only one replica refreshes a stale entry at a time. If
Redis is unreachable the proxy keeps working from its in-memory cache and
reconnects automatically.

```bash
docker compose -f docker-compose.scale.yml up --build --scale stats=3
# nginx on :8081 -> 3 replicas -> shared Redis
```

## Development

```bash
npm install
npm run build && VEX_API_KEY=... TEAMS_VIQRC=1234A npm start   # API + UI on :8080
npm run dev                                                    # Vite on :5174, proxies /api/vex to :8080
```

## CI

`.github/workflows/docker.yml` builds amd64 and arm64 natively in a matrix (no emulation) on every push and PR, then merges them into one multi-arch tag. Pushes to `main` and `v*` tags publish to `ghcr.io/<owner>/<repo>` (`latest`, `sha-*`, and semver tags). Pull requests only verify the build. No secrets needed beyond the default `GITHUB_TOKEN`.
