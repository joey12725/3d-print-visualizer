# Development

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests: parser, every slicer flavor, colors, pricing, file opening, sharing
npm run check      # svelte-check / TypeScript, 0 errors and 0 warnings
npm run build      # dist/index.html, a single self-contained file
npm run sample     # procedural sample G-code into samples/
```

Node 22.18 or newer.

## Testing with real slicer output

```sh
GCODE_SAMPLES=a.gcode:b.gcode npm test
```

`test/real-files.test.ts` parses each file and prints a one-line summary (slicer, printer, layers, time,
grams, timing) so regressions are easy to spot.

## Conventions

- **The build stays one file.** `vite-plugin-singlefile` inlines the parser worker and the CSS, because every
  preview link ships its own copy of the viewer. `scripts/deploy.sh` also checks that the bundle contains
  exactly one `</head>` (see `src/lib/share/social.ts`).
- **The default screen stays glanceable.** Plate layout, print time and grams come first. Color modes, line
  types and display options live under **Details**.
- **Heavy data stays raw.** Parse results are typed arrays held in `$state.raw` and transferred from the
  worker without copying. Changing the layer range or hidden line types only touches shader uniforms.
- After a UI change, check desktop and a phone-sized viewport (around 430 × 932), each with no file open and
  with a file open. The whole plate should be in frame.

## Hosting

The viewer is a static page and runs anywhere: `npm run build` and serve `dist/`. Preview links need a
[here.now](https://here.now) account; see [sharing.md](sharing.md). `npm run deploy` publishes to here.now and
records the site in `herenow.json` (delete that file to create a site of your own). After deploying,
`scripts/refresh-previews.sh` gives every unexpired link the new viewer.

## Agent skill

[`skills/print-preview/SKILL.md`](../skills/print-preview/SKILL.md) teaches a coding agent the whole preview
flow: run `scripts/share.sh` after slicing, then reply with the link, print time, grams and expiry. For Claude
Code, symlink the folder into `~/.claude/skills/print-preview`.
