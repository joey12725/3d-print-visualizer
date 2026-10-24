<img src="assets/icon.svg" width="64" height="64" alt="">

# Print Preview

A fast, phone-friendly 3D viewer for already-sliced G-code, built for a **Creality K2 Plus** and a **Bambu Lab A1**.

**Live:** https://sleek-nirvana-3mxh.here.now/ (password protected; see [Hosting](#hosting-on-herenow))

- Drop a `.gcode`, `.gcode.3mf` (Bambu "Export plate sliced file") or `.gcode.gz`. Parsing happens in your browser.
- Each printer has its own build plate model: the K2 Plus 350 mm plate with a pull tab and leveling screws, and the A1 256 mm plate with alignment pins. The plate surface follows the plate type in the file (Textured PEI, Cool Plate, Smooth/High Temp, Engineering). Other printers get a plate sized from the G-code.
- Color by **line type, filament, speed, layer height, line width, flow, layer time, layer time (log), fan speed, temperature, acceleration**. Colors match Bambu Studio / OrcaSlicer.
- Print time (the slicer's estimate), filament length, weight and cost for each color. Default prices are PLA $14/kg, PETG $15/kg, ASA $19/kg and TPU $19/kg; you can edit them in the app.
- Layer range slider, a move-by-move scrubber, print playback, gray ghosting of layers below the range, show/hide by line type, travel moves and retractions.
- Tap or click a line to see its speed, flow, width, height, fan, temperature and acceleration. Double-click/double-tap to orbit around that point. **Reset view** and camera presets.
- **Share links**: one tap publishes a copy of the preview to its own here.now site. here.now **deletes it automatically after 14 days**.

## Using it

| | Desktop | Phone |
|---|---|---|
| Rotate | left-drag | one finger |
| Zoom | scroll | pinch |
| Pan | right-drag | two fingers |
| Layers | slider on the right, `↑` `↓` (Shift = ×10) | slider above the play bar |
| Moves in top layer | bottom bar, `←` `→` | bottom bar |
| Play / pause | `Space` | ▶ |
| Reset camera | `R` or **Reset view** | **Reset view** |
| Show everything | `A` or **All** | **All** |

## How sharing and expiry work

```
Main site (permanent, password)          Share site (public link, TTL 14 days)
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ index.html (the whole viewer)│  copy → │ index.html                   │
│ .herenow/proxy.json          │         │ print.gcode.gz               │
│   /api/share/create  ──┐     │         │ share.json (name, expiry)    │
│   /api/share/site/*  ──┤     │         └──────────────────────────────┘
└────────────────────────┼─────┘
                         └─► here.now API, with GCODE_VIZ_PUBLISH_KEY injected server-side
```

1. The browser gzips the G-code (about 3× smaller; a 69 MB K2 Plus file uploads as 22 MB) and asks the main site's proxy route to create a new here.now site with `ttlSeconds = 1209600`.
2. The proxy adds the API key on the server (here.now proxy routes plus an account variable), so the key never reaches the browser.
3. The browser uploads the viewer page, the gzipped G-code and a small manifest straight to storage, then finalizes the site.
4. When a share link opens, the page finds `share.json` and loads `print.gcode.gz`. After 14 days here.now removes the whole site.

Share links you've made are listed in the app (stored in that browser's localStorage) with the days left on each.

## Hosting on here.now

- Site: `sleek-nirvana-3mxh` (slug recorded in `herenow.json`)
- Password protected, because its proxy routes can publish sites to the account. Share sites are public links. To change or remove the password, use the here.now dashboard or `PATCH /api/v1/publish/sleek-nirvana-3mxh/metadata {"password": …}`.
- Account variable `GCODE_VIZ_PUBLISH_KEY` holds a dedicated API key named `3d-print-visualizer-proxy`, pinned to the `here.now` upstream. You can revoke that key from the dashboard at any time; sharing stops working, but nothing else is affected.

Deploy:

```sh
npm install
npm run deploy      # build + publish dist/ to the same site
```

`scripts/deploy.sh` reads the API key from `$HERENOW_API_KEY` or `~/.herenow/credentials`.

## Development

```sh
npm run dev         # http://localhost:5173
npm test            # parser/color/pricing unit tests
GCODE_SAMPLES=a.gcode:b.gcode npm test   # also parse real files and print a summary
npm run check       # svelte-check / TypeScript
```

Share links only work on the hosted site (it owns the proxy routes). Set `VITE_SHARE_ENABLED=1` to show the button elsewhere.

### Code map

| Path | What it does |
|---|---|
| `src/lib/gcode/parser.ts` | Streaming G-code parser: Bambu/Orca/Creality/Prusa/Cura annotations, G2/G3 arcs, relative/absolute modes, tool changes, M106/M104/M204 and Klipper macros, plus a lookahead planner calibrated to the slicer's time estimate (per layer via `;TIME_ELAPSED` when available) |
| `src/lib/gcode/worker.ts`, `source.ts` | Runs the parser off the main thread; opens `.gcode`, `.gz` and `.3mf`/zip (with a plate picker) |
| `src/lib/render/viewer.ts`, `shaders.ts` | three.js stage. Each extrusion is one GPU instance expanded into a tube in the vertex shader; layer/move ranges, hidden line types and ghosting are uniforms, so scrubbing never rebuilds geometry. GPU picking, render on demand |
| `src/lib/render/printers.ts` | K2 Plus and A1 build plates, plate surfaces, build volume |
| `src/lib/render/colors.ts` | Color modes and legends |
| `src/lib/share/share.ts` | here.now share flow |
| `src/lib/ui/*` | Svelte 5 components: panel, sliders, timeline, inspect card |

The build is a single self-contained `index.html` (vite-plugin-singlefile), which is why each share site can carry its own copy of the viewer.
