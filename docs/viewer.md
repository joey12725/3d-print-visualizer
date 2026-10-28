# Using the viewer

**At a glance** (always visible): file name, print time, filament weight, then each filament with its
grams, length and cost, plus the layer count, height and total filament cost. On a phone this lives in the
bottom sheet. Its collapsed bar shows the name, time, grams and filament colors.

Screens under 900 px wide get the phone layout (bottom sheet). Separately, the layer slider sits along the
bottom on any vertical screen (taller than wide), including a portrait desktop monitor, and on the right
side on horizontal screens, including a phone held sideways.

**Printer chip** (top left): shows which printer the plate is for. Tap it to switch.

| Printer | Plate | Body |
|---|---|---|
| Creality K2 Plus | black textured PEI, front pull tab | very dark grey, enclosure frame |
| Bambu Lab A1 | bronze/gold textured PEI, rear pins | very light grey bed slinger: carriage, Y-beam, feet |

**Camera pad** (top right): ⌂ resets the view, ↑ top, ↓ front, ← left, → right. Drag to rotate
(one finger), scroll or pinch to zoom, right-drag or two fingers to pan. Double-click or double-tap a
line to orbit around it. Press `R` to reset.

**Layer slider**: along the bottom on vertical screens, on the right on horizontal ones. Drag either end, or drag the
middle to move the whole range. `↑`/`↓` move the top layer (hold Shift to move 10). **All** / `A` shows
every layer again.

**Tap a line** to see its type, layer, speed, flow, width, height, fan, temperature and acceleration.

**Details** (folded by default):
- Color by: line type, filament, speed, layer height, line width, flow, layer time, layer time (log),
  fan speed, temperature or acceleration. In line-type mode you can hide types (click to toggle,
  double-click to show only that type).
- Display: 3D lines or fast lines, travel moves, retractions, grey layers below the range, build volume,
  printer override.
- File: slicer and version, printer profile, nozzle, plate type, filament profiles, and filament prices
  ($/kg: PLA 14, PETG 15, ASA 19, TPU 19 by default; editable).

**Share**: on the main site, "Create 14-day link" publishes the open file as a preview link. Links you've
made are listed underneath with the days they have left. On a preview link you get "Copy link" and
"Download G-code", which saves the plain `.gcode` file (not the compressed copy) named after the print.
