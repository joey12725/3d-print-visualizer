// Procedural sample G-code. Nothing here comes from a slicer or a real model: the
// geometry is generated from formulas, so the output is free to redistribute (CC0).
//
// It writes a two-color plate in the annotation style of four slicer families, which
// makes it handy for screenshots, demos and parser tests:
//
//   bambu   Bambu Studio style (; FEATURE:, ; CHANGE_LAYER), Bambu Lab A1
//   orca    OrcaSlicer / Creality Print style (;TYPE:, ;LAYER_CHANGE), Creality K2 Plus, Klipper
//   prusa   PrusaSlicer style (;TYPE:External perimeter), generic 250 x 210 bed
//   cura    Cura style (;LAYER:n, ;TYPE:WALL-OUTER), Marlin, absolute E, single color
//
//   node scripts/sample-gcode.ts [flavor] [out.gcode]      (Node 22.18+)
//   npm run sample                                          (all flavors into samples/)

export type Flavor = 'bambu' | 'orca' | 'prusa' | 'cura';
export const FLAVORS: Flavor[] = ['bambu', 'orca', 'prusa', 'cura'];

type Pt = [number, number];
type Loop = Pt[];

const W = 0.42; // line width
const LH = 0.2; // layer height
const FIL_AREA = Math.PI * 0.875 ** 2; // 1.75 mm filament
const E_PER_MM = (W - LH) * LH + Math.PI * (LH / 2) ** 2; // extruded cross-section (mm²)

// ------------------------------------------------------------------ geometry

const TAU = Math.PI * 2;

/** Twisted seven-petal column: radius swells toward the middle, petals turn 100° over the height. */
function flower(cx: number, cy: number, z: number, h: number): Loop[] {
  const t = z / h;
  const r0 = 21 + 6 * Math.sin(Math.PI * Math.min(1, t * 1.15));
  const twist = (t * 100 * Math.PI) / 180;
  const n = 210;
  const loop: Loop = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = r0 * (1 + 0.13 * Math.cos(7 * (a - twist)));
    loop.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return [loop];
}

/** Hex nut: hexagon (counter-clockwise) with a round hole (clockwise). */
function nut(cx: number, cy: number, across: number, hole: number, turn: number): Loop[] {
  const R = across / Math.sqrt(3);
  const hex: Loop = [];
  for (let i = 0; i < 6; i++) {
    const a = turn + (i / 6) * TAU;
    hex.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  const hl: Loop = [];
  for (let i = 0; i < 72; i++) {
    const a = -(i / 72) * TAU;
    hl.push([cx + (hole / 2) * Math.cos(a), cy + (hole / 2) * Math.sin(a)]);
  }
  return [hex, hl];
}

function square(cx: number, cy: number, s: number): Loop[] {
  const h = s / 2;
  return [
    [
      [cx - h, cy - h],
      [cx + h, cy - h],
      [cx + h, cy + h],
      [cx - h, cy + h],
    ],
  ];
}

/** Moves every vertex `d` mm toward the material side (left of the edge direction). */
function offset(loops: Loop[], d: number): Loop[] {
  return loops.map((loop) =>
    loop.map((p, i) => {
      const a = loop[(i - 1 + loop.length) % loop.length];
      const b = loop[(i + 1) % loop.length];
      const n1 = leftNormal(a, p);
      const n2 = leftNormal(p, b);
      let mx = n1[0] + n2[0];
      let my = n1[1] + n2[1];
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const k = Math.min(2, 1 / Math.max(0.2, mx * n1[0] + my * n1[1]));
      return [p[0] + mx * d * k, p[1] + my * d * k] as Pt;
    }),
  );
}

function leftNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** Parallel lines at `angle` (degrees), `spacing` apart, clipped to the loops (even-odd). */
function hatch(loops: Loop[], angle: number, spacing: number): [Pt, Pt][] {
  const c = Math.cos((angle * Math.PI) / 180);
  const s = Math.sin((angle * Math.PI) / 180);
  const rot = (p: Pt): Pt => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
  const unrot = (p: Pt): Pt => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  const rl = loops.map((l) => l.map(rot));
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of rl) for (const p of l) (lo = Math.min(lo, p[1])), (hi = Math.max(hi, p[1]));
  const out: [Pt, Pt][] = [];
  let row = 0;
  for (let y = Math.ceil(lo / spacing) * spacing + spacing / 2; y < hi; y += spacing, row++) {
    const xs: number[] = [];
    for (const l of rl)
      for (let i = 0; i < l.length; i++) {
        const a = l[i];
        const b = l[(i + 1) % l.length];
        if (a[1] <= y !== b[1] <= y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    xs.sort((p, q) => p - q);
    const segs: [Pt, Pt][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > W) segs.push([unrot([xs[i], y]), unrot([xs[i + 1], y])]);
    // zig-zag: every other row runs backwards
    if (row % 2) segs.reverse().forEach((g) => g.reverse());
    out.push(...segs);
  }
  return out;
}

// ------------------------------------------------------------------ writer

interface Style {
  layer(n: number, z: number): string[];
  feature(name: string): string;
  width(w: number): string;
  names: Record<string, string>;
}

const STYLES: Record<Flavor, Style> = {
  bambu: {
    layer: (_n, z) => ['; CHANGE_LAYER', `; Z_HEIGHT: ${r3(z)}`, `; LAYER_HEIGHT: ${LH}`],
    feature: (f) => `; FEATURE: ${f}`,
    width: (w) => `; LINE_WIDTH: ${w}`,
    names: {},
  },
  orca: {
    layer: (_n, z) => [';LAYER_CHANGE', `;Z:${r3(z)}`, `;HEIGHT:${LH}`],
    feature: (f) => `;TYPE:${f}`,
    width: (w) => `;WIDTH:${w}`,
    names: {},
  },
  prusa: {
    layer: (_n, z) => [';LAYER_CHANGE', `;Z:${r3(z)}`, `;HEIGHT:${LH}`],
    feature: (f) => `;TYPE:${f}`,
    width: (w) => `;WIDTH:${w}`,
    names: {
      'Outer wall': 'External perimeter',
      'Inner wall': 'Perimeter',
      'Sparse infill': 'Internal infill',
      'Internal solid infill': 'Solid infill',
      'Top surface': 'Top solid infill',
      'Bottom surface': 'Solid infill',
      Brim: 'Skirt/Brim',
      'Prime tower': 'Wipe tower',
    },
  },
  cura: {
    layer: (n) => [`;LAYER:${n}`],
    feature: (f) => `;TYPE:${f}`,
    width: () => '',
    names: {
      'Outer wall': 'WALL-OUTER',
      'Inner wall': 'WALL-INNER',
      'Sparse infill': 'FILL',
      'Internal solid infill': 'SKIN',
      'Top surface': 'SKIN',
      'Bottom surface': 'SKIN',
      Brim: 'SKIRT',
      'Prime tower': 'SUPPORT',
    },
  },
};

const r3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const r5 = (v: number) => (Math.round(v * 100000) / 100000).toString();

const SPEED: Record<string, number> = {
  'Outer wall': 200,
  'Inner wall': 300,
  'Sparse infill': 270,
  'Internal solid infill': 250,
  'Top surface': 200,
  'Bottom surface': 250,
  Brim: 50,
  'Prime tower': 200,
};

const HEADERS: Record<Flavor, string[]> = {
  bambu: [
    '; generated by sample-gcode.ts (procedural, CC0)',
    '; printer_model = Bambu Lab A1',
    '; curr_bed_type = Textured PEI Plate',
    '; printable_area = 0x0,256x0,256x256,0x256',
    '; printable_height = 256',
    '; nozzle_diameter = 0.4',
    '; filament_type = PLA;PLA',
    '; filament_colour = #F2A93B;#2F8F9D',
    '; filament_settings_id = "Sample PLA Amber";"Sample PLA Teal"',
    '; filament_density = 1.24;1.24',
    '; filament_diameter = 1.75;1.75',
  ],
  orca: [
    '; generated by sample-gcode.ts (procedural, CC0)',
    '; printer_model = Creality K2 Plus',
    '; curr_bed_type = High Temp Plate',
    '; printable_area = 0x0,350x0,350x350,0x350',
    '; printable_height = 350',
    '; nozzle_diameter = 0.4',
    '; filament_type = PLA;PETG',
    '; filament_colour = #E4572E;#F3F1EA',
    '; filament_density = 1.24;1.27',
    '; filament_diameter = 1.75;1.75',
  ],
  prusa: [
    '; generated by sample-gcode.ts (procedural, CC0)',
    '; printer_model = MK-style 250x210',
    '; bed_shape = 0x0,250x0,250x210,0x210',
    '; max_print_height = 210',
    '; nozzle_diameter = 0.4',
    '; filament_type = PETG;PETG',
    '; filament_colour = #3D5A80;#EE6C4D',
    '; filament_density = 1.27;1.27',
  ],
  cura: [';FLAVOR:Marlin', ';Generated with sample-gcode.ts (procedural, CC0)', ';filament_type = PLA'],
};

/** Where each part goes on each printer's bed. */
const LAYOUT: Record<Flavor, { flower: Pt; nut: Pt; tower: Pt }> = {
  bambu: { flower: [112, 136], nut: [168, 98], tower: [176, 170] },
  orca: { flower: [160, 185], nut: [218, 145], tower: [225, 220] },
  prusa: { flower: [105, 110], nut: [162, 75], tower: [170, 145] },
  cura: { flower: [110, 115], nut: [168, 80], tower: [0, 0] },
};

const FLOWER_H = 60;
const NUT_H = 16;

export function sampleGcode(flavor: Flavor = 'bambu'): string {
  const style = STYLES[flavor];
  const lay = LAYOUT[flavor];
  const twoColor = flavor !== 'cura';
  const absoluteE = flavor === 'cura';
  const out: string[] = [...HEADERS[flavor], ''];
  let x = 0;
  let y = 0;
  let e = 0;
  let tool = 0;
  let lastFeature = '';

  const emit = (s: string) => s && out.push(s);
  const eArg = (de: number) => (absoluteE ? r5((e += de)) : r5(de));

  const travel = (p: Pt, z?: number) => {
    const far = Math.hypot(p[0] - x, p[1] - y) > 2;
    if (far) emit(`G1 E${eArg(-0.8)} F2400`);
    emit(`G1 X${r3(p[0])} Y${r3(p[1])}${z !== undefined ? ` Z${r3(z)}` : ''} F30000`);
    if (far) emit(`G1 E${eArg(0.8)} F2400`);
    [x, y] = p;
  };

  const extrude = (p: Pt, speed: number) => {
    const d = Math.hypot(p[0] - x, p[1] - y);
    if (d < 1e-3) return;
    emit(`G1 X${r3(p[0])} Y${r3(p[1])} E${eArg((d * E_PER_MM) / FIL_AREA)} F${speed * 60}`);
    [x, y] = p;
  };

  const feature = (name: string, layer: number) => {
    if (name !== lastFeature) {
      emit(style.feature(style.names[name] ?? name));
      emit(style.width(W));
      lastFeature = name;
    }
    return layer === 0 ? Math.min(50, SPEED[name]) : SPEED[name];
  };

  const loops = (ls: Loop[], name: string, layer: number) => {
    const v = feature(name, layer);
    for (const l of ls) {
      // seam at the vertex furthest along +Y so it lines up layer to layer
      let s = 0;
      for (let i = 1; i < l.length; i++) if (l[i][1] > l[s][1]) s = i;
      travel(l[s]);
      for (let i = 1; i <= l.length; i++) extrude(l[(s + i) % l.length], v);
    }
  };

  const fill = (segs: [Pt, Pt][], name: string, layer: number) => {
    if (!segs.length) return;
    const v = feature(name, layer);
    for (const [a, b] of segs) {
      travel(a);
      extrude(b, v);
    }
  };

  /** Walls inside-out, then infill. `top`/`bottom` are solid layer counts. */
  const part = (shape: Loop[], layer: number, layersLeft: number, sparseSpacing: number) => {
    loops(offset(shape, W * 1.45), 'Inner wall', layer);
    loops(offset(shape, W / 2), 'Outer wall', layer);
    const inner = offset(shape, W * 2.2);
    const ang = layer % 2 ? 135 : 45;
    if (layer < 3) fill(hatch(inner, ang, W * 0.95), 'Bottom surface', layer);
    else if (layersLeft === 0) fill(hatch(inner, ang, W * 0.95), 'Top surface', layer);
    else if (layersLeft <= 3) fill(hatch(inner, ang, W * 0.95), 'Internal solid infill', layer);
    else fill([...hatch(inner, 45, sparseSpacing), ...hatch(inner, 135, sparseSpacing)], 'Sparse infill', layer);
  };

  const toolChange = (t: number) => {
    if (t === tool) return;
    emit(`G1 E${eArg(-0.8)} F2400`);
    emit(`T${t}`);
    emit(`G1 E${eArg(0.8)} F2400`);
    tool = t;
  };

  // start
  if (flavor === 'orca') emit('START_PRINT EXTRUDER_TEMP=220 BED_TEMP=55');
  else {
    emit('M140 S55');
    emit('M104 S220');
    emit('M109 S220');
  }
  emit('G28');
  emit('G90');
  emit(absoluteE ? 'M82' : 'M83');
  emit('M204 S5000');
  emit('M106 S0');
  if (absoluteE) emit('G92 E0');

  const layers = Math.round(FLOWER_H / LH);
  const nutLayers = Math.round(NUT_H / LH);
  for (let L = 0; L < layers; L++) {
    const z = LH * (L + 1);
    for (const s of style.layer(L, z)) emit(s);
    if (L === 1) emit('M106 S255');
    emit(`G1 Z${r3(z)} F600`);
    lastFeature = '';

    const fl = flower(lay.flower[0], lay.flower[1], z, FLOWER_H);
    const nt = L < nutLayers ? nut(lay.nut[0], lay.nut[1], 34, 18, 0.2) : null;
    const tw = twoColor && nt ? square(lay.tower[0], lay.tower[1], 16) : null;

    if (L === 0) {
      // brim around everything on the first layer
      for (const shape of [fl, nt, tw]) {
        if (!shape) continue;
        const outer = [shape[0]];
        for (let k = 6; k >= 1; k--) loops(offset(outer, -W * (k - 0.5)), 'Brim', 0);
      }
    }

    const doFlower = () => part(fl, L, layers - 1 - L, 5.5);
    const doNut = () => nt && part(nt, L, nutLayers - 1 - L, 5.5);
    const doTower = () => {
      if (!tw) return;
      loops(offset(tw, W / 2), 'Prime tower', L);
      fill(hatch(offset(tw, W * 1.2), L % 2 ? 135 : 45, L < 2 ? W : 1.6), 'Prime tower', L);
    };

    if (!twoColor) {
      doFlower();
      doNut();
    } else if (!nt) {
      toolChange(0);
      doFlower();
    } else if (tool === 0) {
      // one color change per layer: finish this color, change, prime, other color
      doFlower();
      toolChange(1);
      doTower();
      doNut();
    } else {
      doNut();
      toolChange(0);
      doTower();
      doFlower();
    }
  }

  emit(`G1 E${eArg(-0.8)} F2400`);
  emit(`G1 Z${r3(FLOWER_H + 10)} F600`);
  emit('M104 S0');
  emit('M140 S0');
  emit('M107');
  emit(`; total layer number: ${layers}`);
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const [flavorArg, outArg] = process.argv.slice(2);
  const flavors = flavorArg && flavorArg !== 'all' ? [flavorArg as Flavor] : FLAVORS;
  for (const f of flavors) {
    if (!FLAVORS.includes(f)) throw new Error(`unknown flavor "${f}" (use ${FLAVORS.join(', ')})`);
    const file = outArg ?? `samples/twist-vase-${f}.gcode`;
    mkdirSync(file.replace(/\/[^/]*$/, '') || '.', { recursive: true });
    writeFileSync(file, sampleGcode(f));
    console.log(file);
  }
}
