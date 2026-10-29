# Architecture

```
file ──► worker.ts ─► source.ts (gz / 3mf / zip) ─► parser.ts ─► ParseResult (typed arrays)
                                                                      │ transferred, no copy
                                       state.svelte.ts ◄──────────────┘
                                             │
                     Stage.svelte ─► viewer.ts (three.js) + printers.ts + colors.ts
                     Panel / LayerSlider / ViewControls / PrinterBadge / InspectCard
```

## Parser (`src/lib/gcode/parser.ts`)

- Streams text chunks and never builds one giant string. A 69 MB K2 Plus file parses in about 1 s.
- Understands annotations from Bambu Studio (`; FEATURE:`, `; LINE_WIDTH:`, `; CHANGE_LAYER`, `; Z_HEIGHT:`),
  Orca/Creality Print (`;TYPE:`, `;WIDTH:`, `;LAYER_CHANGE`, `;Z:`, `;TIME_ELAPSED:`), PrusaSlicer and Cura.
- Handles G0/G1/G2/G3 (arcs are flattened to 0.015 mm), G90/G91/M82/M83/G92, tool changes `Tn`,
  `M104/M109` (including Bambu's `H` parameter), `M106/M107` (part fan only), `M204`, and Klipper
  `SET_VELOCITY_LIMIT` / `START_PRINT EXTRUDER_TEMP=`.
- Start G-code (purge lines) is folded into layer 1, so the layer count matches the slicer.
- Time model: a Klipper-style lookahead planner (square-corner velocity + centripetal limit, trapezoids),
  then calibrated against the slicer: piecewise per layer using `;TIME_ELAPSED` (Orca/Creality),
  otherwise one global scale to the slicer total. The headline print time is always the slicer's number.
- Filament per color: the slicer-reported length/weight when present, otherwise net E per tool.

## Renderer (`src/lib/render`)

- One GPU instance per extrusion segment. `shaders.ts` expands a 10-vertex template into a tube with a
  diamond cross-section, smooth normals and pointed caps, centered half a layer below the G-code Z.
- Layer range, ghosting and hidden line types are uniforms (`uRange`, `uGhost`, `uVis`), so moving a slider
  never rebuilds buffers. `instanceCount` skips instances past the range end.
- Colors are a `Uint8` instanced attribute recomputed on the CPU when the color mode changes (`colors.ts`).
- Picking renders instance IDs into a 1×1 target.
- Rendering only happens when something changes. The camera re-frames on resize until the user moves it,
  and `setInsets()` keeps the model centered in the part of the screen that UI doesn't cover.
- `printers.ts` builds the plates procedurally: canvas textures for the surface, grid and labels, a tiled
  bump map for textured PEI grain, plus simple geometry for each printer's "visual language" (K2 Plus
  enclosure frame, A1 Y-beam and feet). `DEFAULT_HOLO` sets which smooth-plate pattern each printer gets.
- `holo.ts` patches the plate's `MeshStandardMaterial` (`onBeforeCompile`) for smooth plates: a fake
  diffraction grating (a hex grid of small discs with circular grooves, or crosshatch) lit by the key light and a light at the camera.

## UI (`src/lib/ui`, `src/App.svelte`)

Svelte 5 runes. `state.svelte.ts` holds the app state; heavy data is `$state.raw`. Preferences (color mode,
display options, printer override, whether Details is open, filament prices) persist in localStorage.

## Build

Vite + `vite-plugin-singlefile` produce a single `dist/index.html` with the parser worker inlined, plus
`dist/.herenow/proxy.json` for the main site.
