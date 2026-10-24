# Sharing and hosting on here.now

## Pieces

| Thing | Value |
|---|---|
| Main viewer site | slug and URL in `herenow.json` (`sleek-nirvana-3mxh`) |
| Account variable | `GCODE_VIZ_PUBLISH_KEY`, pinned to upstream `here.now` |
| API key behind it | `3d-print-visualizer-proxy` (here.now dashboard → API keys) |
| Proxy manifest | `public/.herenow/proxy.json` → `/api/share/create`, `/api/share/site/*` |
| Preview lifetime | `ttlSeconds = 1209600` (14 days), set on every share |

## A preview site

Each share is a separate here.now site with three files:

```
index.html       the whole viewer (copied from the main site)
print.gcode.gz   the G-code, gzip -6
share.json       { v:1, name, createdAt, expiresAt, printer, bytes, thumbnail? }
```

When `index.html` loads, it fetches `./share.json`. If that file exists, the page is in share mode:
it downloads `./print.gcode.gz`, decompresses it in the browser, shows "Shared link · deleted
automatically on …" and hides the create-link button. On the main site `share.json` returns 404,
and the page shows the file picker instead.

## Two ways to create one

1. **Agent / CLI**: run `scripts/share.sh FILE`. It calls the here.now API directly with your API key
   (create → upload to the presigned URLs → finalize).
2. **In the app**: the "Create 14-day link" button on the main site. The browser calls the site's own proxy
   routes, which add `Authorization: Bearer ${GCODE_VIZ_PUBLISH_KEY}` on here.now's servers, so the key never
   reaches the browser. The browser then uploads straight to here.now storage.

## Security notes

- The main site is public (the owner asked for no password). Anyone who finds its URL can use the proxy to
  create sites on the account. Each IP gets 30 creates per hour, and anything created that way that isn't
  a valid share is just a site; the browser flow always sets the 14-day TTL, but a hand-crafted request
  might not. If that becomes a problem: set a site password (`PATCH /api/v1/publish/<slug>/metadata
  {"password":"…"}`; a password also gates the proxy routes), or revoke the key.
- The proxy's prefix route only allows `POST` under `/api/v1/publish/…`.

## Rebuilding the setup from scratch

Only needed if the account or the site changes:

```sh
# 1. a dedicated key
curl -sS https://here.now/api/v1/me/keys -H "Authorization: Bearer $HERENOW_API_KEY" \
  -H 'content-type: application/json' -d '{"name":"3d-print-visualizer-proxy"}'
# 2. store it as the proxy variable (use the "key" from step 1)
curl -sS -X PUT https://here.now/api/v1/me/variables/GCODE_VIZ_PUBLISH_KEY \
  -H "Authorization: Bearer $HERENOW_API_KEY" -H 'content-type: application/json' \
  -d '{"value":"hnk_…","allowedUpstreams":["here.now"]}'
# 3. deploy (delete herenow.json first to create a brand-new site)
npm ci && npm run deploy
```
