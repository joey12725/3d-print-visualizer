# Sharing and hosting on here.now

## Pieces

| Thing | Value |
|---|---|
| Main viewer site | slug and URL in `herenow.json` (`sleek-nirvana-3mxh`) |
| Account variable | `GCODE_VIZ_PUBLISH_KEY`, pinned to upstream `here.now` |
| API key behind it | `3d-print-visualizer-proxy` (here.now dashboard → API keys) |
| Proxy manifest | `public/.herenow/proxy.json` → `/api/share/create`, `/api/share/site/*` |
| Preview lifetime | `ttlSeconds = 1209600` (14 days), set on every share |
| Dashboard folder | `Print previews` (every share is filed here) |

## A preview site

Each share is a separate here.now site with these files:

```
index.html       the whole viewer (copied from the main site), with this link's og:/twitter: tags
print.gcode.gz   the G-code, gzip -6
share.json       { v:1, name, createdAt, expiresAt, printer, bytes, thumbnail? }
og.jpg           link-preview picture, 1200×630: the print on its plate plus name, time, grams, printer
```

### Link previews (Discord, iMessage, …)

here.now adds og:/twitter: tags to any page without them, pointing at its own screenshot, and leaves
existing tags alone. It ignores `viewer.ogImagePath` for sites that have an `index.html`. The main site's
page is served with here.now's tags *for the main site*, so a share copied from it used to unfurl as the
empty "Drop a sliced G-code file" screen. `src/lib/share/social.ts` strips those tags and reserves a fixed-size slot
before `</head>`. Once the create call returns the new site's URL, it fills the slot with tags pointing at
`<url>/og.jpg`. The slot keeps the byte size unchanged, because file sizes are declared before the URL is known.

The picture comes from the viewer itself (`Viewer.snapshot` + `src/lib/share/ogimage.ts`): the default view
with all layers. In the app, "Create 14-day link" renders it from the open print. `share.sh` and
`refresh-previews.sh` serve the link's files on localhost and open them with `?og` in headless Chrome
(`scripts/og-image.mjs`), which hands the picture back. With no Chrome, or an older viewer without `?og`,
the slot stays empty and here.now's own screenshot is used. Chat apps cache unfurls, so a message that was
already posted keeps its old card.

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

## Updating old links

Each preview ships the viewer as it was when the link was made. After `npm run deploy`,
`scripts/refresh-previews.sh` swaps the deployed `index.html` into every unexpired preview in `Print previews`
(or just the slugs you pass). It re-uploads the link's existing `print.gcode.gz` and `share.json` unchanged and
puts the original expiry back if the update moved it. It also renders a fresh `og.jpg` for each link.

## Expiry: what actually happens

Tested on 2026-10-24: once a site's `expiresAt` passes, here.now returns **404** for the site and its
files, but the site record stays on the account (`GET /api/v1/publish/:slug` still answers and it still
shows in listings). `scripts/cleanup-expired.sh` lists the `Print previews` folder and deletes every
site whose `expiresAt` is in the past. `share.sh` runs it quietly after each new share. To run it on a
schedule, call it from cron or your agent's scheduler.

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
