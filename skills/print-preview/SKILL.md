---
name: print-preview
description: Publish a sliced 3D print (.gcode, .gcode.3mf, .gcode.gz) as a 14-day preview link so the user can check it on their phone or laptop before printing. Use right after slicing a print for the Creality K2 Plus or Bambu Lab A1, or whenever the user asks to "preview", "show me", "send me a link to", or "let me check" a G-code / sliced file.
---

# Print Preview

Turns a sliced G-code file into a link like `https://<slug>.here.now/`. The link opens a 3D
viewer of that exact print on the correct build plate (K2 Plus: black plate in a dark
enclosure; A1: bronze plate on a light-grey bed slinger), with print time, filament weight
and grams per color up front. here.now deletes the link automatically after 14 days.

## Send a preview (the whole job)

From the root of this repository:

```sh
scripts/share.sh /path/to/print.gcode --json
```

Example output:

```json
{
  "url": "https://radiant-nimbus-8ffh.here.now/",
  "expiresAt": "2026-11-07T22:09:17.859Z",
  "name": "black-cat-mask.gcode",
  "printer": "a1",
  "printTime": "2h 45m 41s",
  "filamentGrams": 33.5,
  "filamentGramsPerColor": [33.49]
}
```

Then tell the user, in this order:

1. The link (`url`), as a clickable link.
2. Print time and total filament grams, plus grams per color if more than one.
3. The printer it was sliced for and when the link expires.

For example: "Preview: https://radiant-nimbus-8ffh.here.now/ · 2h 46m · 33.5 g PLA · Bambu Lab A1 · link expires Nov 7."

The viewer is built for a quick sanity check: plate layout, relative sizes, supports, time
and filament. You don't need to describe the model. The user will look at it.

## Options

| Flag | Use it when |
|---|---|
| `--plate N` | A `.gcode.3mf` holds several plates. The default is plate 1; send one link per plate if the user wants all of them. |
| `--name "Nice name"` | The file name is ugly (e.g. Bambu's `plate_1.gcode`). Use the project/model name. |
| `--printer k2plus\|a1` | Auto-detection from `printer_model` fails or picks the wrong printer. |
| `--ttl-days N` | The user asks for a different lifetime. The default of 14 is what they want normally. |

Without `--json` the script prints only the URL.

## Expiry and cleanup

Every preview is filed in the **Print previews** folder on here.now. here.now stops serving a
preview once it expires, but the site record stays on the account until it's deleted.
`share.sh` deletes expired previews from that folder every time it runs, so normal use keeps
the account clean. To clean up on demand:

```sh
scripts/cleanup-expired.sh --dry-run   # list expired previews
scripts/cleanup-expired.sh             # delete them
```

It only ever touches sites in the Print previews folder whose expiry has passed.

## Requirements

- `curl`, `jq`, `gzip`, `unzip`, `base64` (all standard on macOS and most Linux distributions).
- A here.now API key in `$HERENOW_API_KEY` or `~/.herenow/credentials`. The script never prints it.
- The main viewer site from `herenow.json` must be live. The script copies its current
  `index.html` into each link. If it can't reach it, it falls back to `dist/index.html`
  (run `npm ci && npm run build` first).

## When something goes wrong

| Symptom | Fix |
|---|---|
| `no sliced G-code inside` | The 3MF is a project file, not a sliced export. Slice it, then use "Export plate sliced file" (Bambu) or export G-code. |
| `plate N not found` | The error lists the plates that exist. Pick one with `--plate`. |
| `create failed: ... 401` | The API key is missing or revoked. |
| `create failed: ... 429` | here.now rate limit. Wait the `retry_after` seconds and retry once. |
| Wrong plate model in the viewer | Re-run with `--printer k2plus` or `--printer a1`. The viewer also has a printer picker (the chip at the top left). |

## Don't

- Don't paste G-code contents into chat, and don't upload the file anywhere else.
- Don't create permanent sites for previews. Keep the TTL.
- Don't delete other sites on the here.now account. `cleanup-expired.sh` handles expired previews.
