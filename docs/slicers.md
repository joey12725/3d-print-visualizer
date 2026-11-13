# Slicers, printers and files

## Slicers

The parser reads each slicer's own annotations, so line types, layers and widths match what you saw in
the slicer preview, and the colors use the same palette.

| Slicer | Layers | Line types | Widths | Print time | Filament per color |
|---|---|---|---|---|---|
| Bambu Studio | `; CHANGE_LAYER`, `; Z_HEIGHT:`, `; LAYER_HEIGHT:` | `; FEATURE:` | `; LINE_WIDTH:` | `total estimated time` | `filament used [g]` / `[mm]` |
| OrcaSlicer | `;LAYER_CHANGE`, `;Z:`, `;HEIGHT:` | `;TYPE:` | `;WIDTH:` | header, plus `;TIME_ELAPSED:` per layer | yes |
| Creality Print | same as OrcaSlicer | `;TYPE:` | `;WIDTH:` | header, plus `;TIME_ELAPSED:` per layer | yes |
| PrusaSlicer / SuperSlicer | `;LAYER_CHANGE`, `;Z:`, `;HEIGHT:` | `;TYPE:` | `;WIDTH:` | `estimated printing time (normal mode)` | yes |
| Cura | `;LAYER:n` | `;TYPE:WALL-OUTER`, `FILL`, `SKIN`, … | from geometry | `;TIME:` | net E per tool |

Anything else still renders: without layer markers, layers come from Z changes, and line types fall back to
"Custom". The print time then comes from the built-in planner.

## Firmware flavors

- **Motion:** `G0`/`G1`, arcs `G2`/`G3` (flattened to 0.015 mm chords), `G90`/`G91`, `G92`.
- **Extrusion:** absolute (`M82`) and relative (`M83`) E, retractions and unretractions, tool changes `Tn`.
- **Temperatures and fans:** `M104`/`M109` (including Bambu's `H` parameter), `M106`/`M107` on the part fan.
- **Acceleration:** `M204`, Klipper `SET_VELOCITY_LIMIT`, and `START_PRINT EXTRUDER_TEMP=` macros.

Marlin, Klipper and Bambu firmware output all parse the same way.

## Printers

| Printer | Detected from | Plate |
|---|---|---|
| Creality K2 Plus | `printer_model` / `printer_settings_id` containing "K2 Plus" | 350 × 350, black textured PEI or holographic smooth PEI, enclosure frame |
| Bambu Lab A1 | "Bambu Lab A1" | 256 × 256, bronze textured PEI or holographic smooth PEI, bed-slinger carriage |
| Anything else | `printable_area` or `bed_shape` from the header | a generic plate sized to the printable area |

The printer chip in the top-left corner overrides detection. Adding another printer means one entry in
`PRINTERS` (`src/lib/render/printers.ts`), a regex in `detectPrinter`, and optionally a body in
`buildPrinterModel`.

## Files

`.gcode`, `.gco`, `.g`, `.gcode.gz`, and `.gcode.3mf` / `.3mf` / `.zip` project exports. A 3MF with several
plates asks which plate to open. Files are streamed in chunks inside a Web Worker, so a 70 MB file parses in
about a second without freezing the page.

## Sample G-code

`scripts/sample-gcode.ts` writes a procedural two-color plate (a twisted seven-petal vase, a hex nut and a
prime tower) in each slicer's annotation style. The geometry comes from formulas rather than a model or a
slicer, so the files are free to share (CC0).

```sh
npm run sample                                     # all flavors into samples/
node scripts/sample-gcode.ts orca out.gcode        # one flavor: bambu, orca, prusa or cura
```

`test/sample.test.ts` parses every flavor and checks that they agree on layers, line types, printer and
filament split. The screenshots in the README are this plate.
