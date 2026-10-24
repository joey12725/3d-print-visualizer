# Agent guide

This repo is **Print Preview**, a browser 3D viewer for sliced G-code for the owner's two printers:
a **Creality K2 Plus** (Creality Print / Klipper) and a **Bambu Lab A1** (Bambu Studio).
It is hosted on here.now. The main site is already deployed and its slug is in `herenow.json`.

## The one thing you'll usually do

After slicing a print, send the owner a preview link:

```sh
scripts/share.sh path/to/file.gcode --json      # also .gcode.3mf (--plate N) and .gcode.gz
```

Then reply with the URL, print time, grams (per color if several), printer and expiry date.
The full playbook is in [`skills/print-preview/SKILL.md`](skills/print-preview/SKILL.md).
Install that folder as a skill if your harness supports skills (for Claude Code, symlink it into
`~/.claude/skills/print-preview`).

What the owner wants from a preview: a fast check on their phone of plate layout, relative sizes,
supports, print time and filament weight. The default UI shows exactly that. Color modes, line
types and display options stay folded under **Details**. Keep that hierarchy when you change the UI.

## Changing the viewer

```sh
npm ci
npm run dev        # local dev server
npm test           # unit tests (parser, colors, pricing, file opening)
npm run check      # svelte-check / TypeScript, must be 0 errors and 0 warnings
npm run deploy     # build + publish to the same here.now site (URL doesn't change)
```

- To test with real slicer output, run `GCODE_SAMPLES=a.gcode:b.gcode npm test`, which parses those files and prints a summary.
- Deploying updates the viewer for future links. Existing links keep the viewer copy they were created with.
- After deploying, open the live main URL and check four states: desktop and a phone-sized viewport
  (around 430×932), each with **no file open** and **with a file open**. The whole plate should be in frame,
  and nothing should be blank or cut off. Checking a share link alone isn't enough, because it skips the empty state.

## Ground rules

- Never commit secrets. The here.now API key lives in `~/.herenow/credentials` or `$HERENOW_API_KEY`.
  The site's proxy routes use the account variable `GCODE_VIZ_PUBLISH_KEY`, which holds a dedicated,
  revocable key named `3d-print-visualizer-proxy`.
- Previews must keep a TTL (14 days by default) and be filed in the `Print previews` folder.
  here.now stops serving expired sites but keeps their records, so `scripts/cleanup-expired.sh` deletes
  expired previews in that folder. `share.sh` runs it automatically every time.
- The build must stay a single self-contained `index.html` (vite-plugin-singlefile), because each share
  link ships its own copy of the viewer.
- `public/.herenow/proxy.json` must keep the `/api/share/*` routes, or the in-app
  "Create 14-day link" button breaks. After deploying, check that the deploy output shows no proxy warnings.
- The owner asked for no password on the main site. Don't add one unless they ask.

## Where things are

See [`docs/architecture.md`](docs/architecture.md) for the code map and data flow,
[`docs/sharing.md`](docs/sharing.md) for the here.now setup, and [`docs/viewer.md`](docs/viewer.md)
for what each control does.
