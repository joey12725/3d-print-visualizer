<img src="assets/icon.svg" width="64" height="64" alt="">

# Print Preview

Check a sliced 3D print on your phone or laptop before it prints. Built for a **Creality K2 Plus** and a **Bambu Lab A1**.

- **Main viewer:** https://sleek-nirvana-3mxh.here.now/ (drop in any `.gcode`, `.gcode.3mf` or `.gcode.gz`)
- **Preview links:** one command (or one button) turns a G-code file into its own link that opens straight into the model. here.now deletes it after 14 days.

```sh
scripts/share.sh print.gcode --json
# → { "url": "https://…here.now/", "printTime": "2h 45m 41s", "filamentGrams": 33.5, … }
```

## What you see

By default, only what you need for a quick check:

- the model on the correct plate: the **K2 Plus** with its black plate in a dark enclosure, or the **A1** with its bronze plate on a light-grey bed slinger
- **print time**, **filament weight**, and **grams per color**
- a layer slider, a camera pad (home / top / front / left / right), and tap-a-line details

Everything else is folded under **Details**: color by line type, filament, speed, layer height, line width, flow, layer time (linear or log), fan, temperature or acceleration; per-line-type visibility; travel moves, retractions, ghosted layers; slicer info; and filament prices (PLA $14, PETG $15, ASA $19, TPU $19 per kg). See [docs/viewer.md](docs/viewer.md).

## For agents

Start with **[AGENTS.md](AGENTS.md)**. The skill at **[skills/print-preview/SKILL.md](skills/print-preview/SKILL.md)** covers the whole preview workflow: run `scripts/share.sh`, then reply with the link, time, grams and expiry.

## Development

```sh
npm ci
npm run dev       # local viewer
npm test          # unit tests
npm run check     # TypeScript / Svelte
npm run deploy    # publish to the main here.now site
```

| Doc | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | parser, renderer, UI, build |
| [docs/sharing.md](docs/sharing.md) | here.now setup, proxy routes, TTL, security, rebuilding from scratch |
| [docs/viewer.md](docs/viewer.md) | every control in the viewer |

Requirements: Node 20+. The share script needs `curl`, `jq`, `gzip`, `unzip` and a here.now API key (`$HERENOW_API_KEY` or `~/.herenow/credentials`).
