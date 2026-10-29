// Printer definitions and their procedurally-built build plates.
//
// Coordinates are G-code millimetres with Z up. Each printer gets a heated bed, a
// removable spring-steel plate whose surface depends on the plate type in the G-code,
// and a faint build-volume outline. Smooth plates are drawn as black holographic PEI
// (see holo.ts); which pattern each printer gets is a user setting.

import * as THREE from 'three';
import type { SlicerMeta } from '../gcode/types';
import { applyHolo, HOLO_CELL_MM, HOLO_DOT_MM, HOLO_DOT_R_MM, type HoloPattern } from './holo';

export type PrinterId = 'k2plus' | 'a1' | 'generic';

export interface PrinterDef {
  id: PrinterId;
  name: string;
  /** printable area in bed coordinates */
  min: [number, number];
  max: [number, number];
  height: number;
}

export const PRINTERS: Record<Exclude<PrinterId, 'generic'>, PrinterDef> = {
  k2plus: { id: 'k2plus', name: 'Creality K2 Plus', min: [0, 0], max: [350, 350], height: 350 },
  a1: { id: 'a1', name: 'Bambu Lab A1', min: [0, 0], max: [256, 256], height: 256 },
};

export function detectPrinter(meta: SlicerMeta): PrinterId {
  const s = `${meta.printerModel} ${meta.printerSettingsId}`.toLowerCase();
  if (/k2\s*plus/.test(s)) return 'k2plus';
  if (/bambu.*\ba1\b(?!\s*mini)/.test(s) || /^bambu lab a1\b(?! mini)/.test(meta.printerModel.toLowerCase())) return 'a1';
  return 'generic';
}

export function genericPrinter(meta: SlicerMeta | null): PrinterDef {
  const area = meta?.printableArea;
  if (area && area.length >= 3) {
    const xs = area.map((p) => p[0]);
    const ys = area.map((p) => p[1]);
    return {
      id: 'generic',
      name: meta?.printerModel || 'Generic printer',
      min: [Math.min(...xs), Math.min(...ys)],
      max: [Math.max(...xs), Math.max(...ys)],
      height: meta?.printableHeight ?? 250,
    };
  }
  return { id: 'generic', name: meta?.printerModel || 'Generic printer', min: [0, 0], max: [250, 250], height: 250 };
}

export function resolvePrinter(id: PrinterId, meta: SlicerMeta | null): PrinterDef {
  return id === 'generic' ? genericPrinter(meta) : PRINTERS[id];
}

// ------------------------------------------------------------------ plate surfaces

export type { HoloPattern } from './holo';

/** Holographic pattern used for smooth plates on each printer, unless the user picks another. */
export const DEFAULT_HOLO: Record<PrinterId, HoloPattern> = { k2plus: 'circular', a1: 'crosshatch', generic: 'none' };

export const HOLO_LABELS: Record<HoloPattern, string> = {
  circular: 'Holographic circles',
  crosshatch: 'Holographic crosshatch',
  none: 'Plain',
};

/**
 * Smooth PEI. Bambu Studio and Creality Print both write it as "High Temp Plate"
 * (their UI says "Smooth PEI Plate / High Temp Plate").
 */
export function isSmoothPlate(bedType: string): boolean {
  return /high\s*temp|smooth/i.test(bedType);
}

interface Surface {
  base: string; // main colour
  speckle: [string, string]; // texture noise colours
  speckleAmount: number; // 0..1
  grid: string;
  gridMajor: string;
  logo: string;
  roughness: number;
  metalness: number;
  label: string;
  /** bump strength of the powder-coat grain (textured PEI), 0 = none */
  grain: number;
}

const SURFACES: Record<string, Surface> = {
  textured: {
    base: '#3B3328',
    speckle: ['#6E5A3C', '#1E1A14'],
    speckleAmount: 0.85,
    grid: 'rgba(255,230,180,0.10)',
    gridMajor: 'rgba(255,230,180,0.22)',
    logo: 'rgba(255,225,170,0.30)',
    roughness: 0.95,
    metalness: 0.15,
    label: 'Textured PEI',
    grain: 8,
  },
  smoothGold: {
    base: '#8C7230',
    speckle: ['#A88C45', '#76602A'],
    speckleAmount: 0.15,
    grid: 'rgba(40,30,0,0.14)',
    gridMajor: 'rgba(40,30,0,0.28)',
    logo: 'rgba(40,30,0,0.30)',
    roughness: 0.45,
    metalness: 0.45,
    label: 'Smooth PEI',
    grain: 0,
  },
  cool: {
    base: '#1D1F22',
    speckle: ['#2A2D31', '#16181A'],
    speckleAmount: 0.4,
    grid: 'rgba(255,255,255,0.08)',
    gridMajor: 'rgba(255,255,255,0.18)',
    logo: 'rgba(255,255,255,0.22)',
    roughness: 0.7,
    metalness: 0.1,
    label: 'Cool Plate',
    grain: 0,
  },
  engineering: {
    base: '#2E3134',
    speckle: ['#3A3E42', '#25282A'],
    speckleAmount: 0.3,
    grid: 'rgba(255,255,255,0.09)',
    gridMajor: 'rgba(255,255,255,0.2)',
    logo: 'rgba(255,255,255,0.22)',
    roughness: 0.6,
    metalness: 0.25,
    label: 'Engineering Plate',
    grain: 0,
  },
  // K2 Plus: black textured PEI
  k2: {
    base: '#121214',
    speckle: ['#26272B', '#08080A'],
    speckleAmount: 0.8,
    grid: 'rgba(255,255,255,0.07)',
    gridMajor: 'rgba(255,255,255,0.16)',
    logo: 'rgba(255,255,255,0.22)',
    roughness: 0.92,
    metalness: 0.1,
    label: 'Textured PEI',
    grain: 8,
  },
  // A1: bronze / gold textured PEI
  a1: {
    base: '#8A6A33',
    speckle: ['#B08A48', '#5E4620'],
    speckleAmount: 0.75,
    grid: 'rgba(40,24,0,0.16)',
    gridMajor: 'rgba(40,24,0,0.32)',
    logo: 'rgba(40,24,0,0.34)',
    roughness: 0.85,
    metalness: 0.35,
    label: 'Textured PEI',
    grain: 8,
  },
  // Smooth PEI on the owner's printers: glossy black (holographic film is added in the shader)
  smoothBlack: {
    base: '#0B0B0D',
    speckle: ['#141417', '#060607'],
    speckleAmount: 0.05,
    grid: 'rgba(255,255,255,0.06)',
    gridMajor: 'rgba(255,255,255,0.15)',
    logo: 'rgba(255,255,255,0.2)',
    roughness: 0.32,
    metalness: 0.2,
    label: 'Smooth PEI',
    grain: 0,
  },
};

/** Body colours: the A1 is very light grey, the K2 Plus very dark grey. */
const BODY: Record<PrinterId, { bed: string; frame: string }> = {
  k2plus: { bed: '#1B1C1F', frame: '#232428' },
  a1: { bed: '#D8DADD', frame: '#C4C7CB' },
  generic: { bed: '#2A2C30', frame: '#34373C' },
};

export function surfaceFor(printer: PrinterId, bedType: string, holo: HoloPattern = 'none'): Surface {
  // Smooth plates on the K2 Plus and A1 are black; elsewhere only when holographic.
  if (isSmoothPlate(bedType) && (printer !== 'generic' || holo !== 'none')) return SURFACES.smoothBlack;
  // Otherwise each printer keeps its own look so it's obvious which machine you're previewing.
  if (printer === 'k2plus') return SURFACES.k2;
  if (printer === 'a1') return SURFACES.a1;
  const b = bedType.toLowerCase();
  if (b.includes('high temp') || b.includes('smooth')) return SURFACES.smoothGold;
  if (b.includes('cool') || b.includes('supertack')) return SURFACES.cool;
  if (b.includes('engineering')) return SURFACES.engineering;
  return SURFACES.textured;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plate texture: surface finish, 10 mm grid, labels and an origin marker. */
function plateTexture(def: PrinterDef, s: Surface, plateMin: [number, number], plateSize: [number, number], logo: string, holo: HoloPattern) {
  const pxPerMm = Math.min(6, 2048 / Math.max(plateSize[0], plateSize[1]));
  const W = Math.round(plateSize[0] * pxPerMm);
  const H = Math.round(plateSize[1] * pxPerMm);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = s.base;
  g.fillRect(0, 0, W, H);

  // speckle / texture
  const rnd = mulberry32(1234);
  const dots = Math.round(W * H * 0.06 * s.speckleAmount);
  for (let i = 0; i < dots; i++) {
    g.fillStyle = rnd() > 0.5 ? s.speckle[0] : s.speckle[1];
    g.globalAlpha = 0.25 + rnd() * 0.5;
    const r = 0.6 + rnd() * 1.4;
    g.fillRect(rnd() * W, rnd() * H, r, r);
  }
  g.globalAlpha = 1;

  // bed mm -> canvas px (canvas Y grows down, bed Y grows back)
  const px = (x: number) => (x - plateMin[0]) * pxPerMm;
  const py = (y: number) => H - (y - plateMin[1]) * pxPerMm;

  // the holographic film's pattern is faintly visible even where it isn't catching the light
  if (holo !== 'none') {
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.lineWidth = Math.max(1, 0.25 * pxPerMm);
    const cx = px((def.min[0] + def.max[0]) / 2);
    const cy = py((def.min[1] + def.max[1]) / 2);
    const reach = Math.hypot(W, H);
    if (holo === 'circular') {
      // disc outlines on the same hex grid as the shader (centres at (i·S, j·S√3) and offset by half)
      const sx = HOLO_DOT_MM * pxPerMm;
      const sy = HOLO_DOT_MM * Math.sqrt(3) * pxPerMm;
      const r = HOLO_DOT_R_MM * pxPerMm;
      g.beginPath();
      for (const [ox, oy] of [[0, 0], [sx / 2, sy / 2]]) {
        for (let x = cx + ox - Math.ceil(cx / sx) * sx; x < W + r; x += sx) {
          for (let y = cy - oy - Math.ceil(cy / sy) * sy; y < H + r; y += sy) {
            g.moveTo(x + r, y);
            g.arc(x, y, r, 0, Math.PI * 2);
          }
        }
      }
      g.stroke();
    } else {
      // lines x ± y = n·cell·√2 through the centre, in both diagonal directions
      const step = HOLO_CELL_MM * Math.SQRT2 * pxPerMm;
      g.beginPath();
      for (let k = -Math.ceil(reach / step) * step; k < reach; k += step) {
        g.moveTo(cx + k - reach, cy - reach);
        g.lineTo(cx + k + reach, cy + reach);
        g.moveTo(cx + k + reach, cy - reach);
        g.lineTo(cx + k - reach, cy + reach);
      }
      g.stroke();
    }
  }

  // grid over the printable area
  const [x0, y0] = def.min;
  const [x1, y1] = def.max;
  for (let x = Math.ceil(x0 / 10) * 10; x <= x1 + 1e-6; x += 10) {
    const major = Math.round(x) % 50 === 0;
    g.strokeStyle = major ? s.gridMajor : s.grid;
    g.lineWidth = major ? 2 : 1;
    g.beginPath();
    g.moveTo(px(x), py(y0));
    g.lineTo(px(x), py(y1));
    g.stroke();
  }
  for (let y = Math.ceil(y0 / 10) * 10; y <= y1 + 1e-6; y += 10) {
    const major = Math.round(y) % 50 === 0;
    g.strokeStyle = major ? s.gridMajor : s.grid;
    g.lineWidth = major ? 2 : 1;
    g.beginPath();
    g.moveTo(px(x0), py(y));
    g.lineTo(px(x1), py(y));
    g.stroke();
  }
  // printable area outline
  g.strokeStyle = s.gridMajor;
  g.lineWidth = 3;
  g.strokeRect(px(x0), py(y1), (x1 - x0) * pxPerMm, (y1 - y0) * pxPerMm);

  // axis labels every 50 mm, just inside the printable area
  g.fillStyle = s.gridMajor;
  g.font = `${Math.round(3.2 * pxPerMm)}px ui-sans-serif, system-ui, sans-serif`;
  g.textBaseline = 'bottom';
  g.textAlign = 'center';
  for (let x = Math.ceil(x0 / 50) * 50; x <= x1 - 10; x += 50) {
    if (x <= x0) continue;
    g.fillText(String(x), px(x), py(y0) - 1.2 * pxPerMm);
  }
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let y = Math.ceil(y0 / 50) * 50; y <= y1 - 10; y += 50) {
    if (y <= y0) continue;
    g.fillText(String(y), px(x0) + 1.2 * pxPerMm, py(y));
  }

  // origin marker: X (red) and Y (green) arrows
  const ox = px(x0);
  const oy = py(y0);
  const L = 14 * pxPerMm;
  g.lineWidth = Math.max(2, 0.8 * pxPerMm);
  g.strokeStyle = '#E5484D';
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox + L, oy);
  g.stroke();
  g.strokeStyle = '#46A758';
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox, oy - L);
  g.stroke();

  // logo near the front edge, plate type near the back, like the real plates
  const cx = px((x0 + x1) / 2);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (logo) {
    g.fillStyle = s.logo;
    g.font = `700 ${Math.round(7 * pxPerMm)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    g.fillText(logo, cx, py(y0 + 9));
  }
  g.fillStyle = s.gridMajor;
  g.font = `500 ${Math.round(2.8 * pxPerMm)}px ui-sans-serif, system-ui, sans-serif`;
  g.fillText(s.label.toUpperCase(), cx, py(y1 - 4));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Tileable powder-coat grain for textured PEI, used as a bump map. Tiles every GRAIN_TILE_MM. */
const GRAIN_TILE_MM = 6;
function grainTexture() {
  const N = 256;
  const rnd = mulberry32(99);
  // two octaves of smoothed value noise on wrapping lattices, so the tile repeats seamlessly
  const octave = (cells: number) => {
    const v = new Float32Array(cells * cells).map(() => rnd());
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const fy = (y / N) * cells;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
        const ty = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
        const at = (i: number, j: number) => v[(j % cells) * cells + (i % cells)];
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        out[y * N + x] = a + (b - a) * ty;
      }
    }
    return out;
  };
  const coarse = octave(64);
  const fine = octave(128);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const h = Math.round((coarse[i] * 0.6 + fine[i] * 0.4) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = h;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Map shape-space XY to 0..1 UVs over the plate rectangle. */
function planarUV(geo: THREE.BufferGeometry, min: [number, number], size: [number, number]) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - min[0]) / size[0];
    uv[i * 2 + 1] = (pos.getY(i) - min[1]) / size[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export interface PrinterModel {
  group: THREE.Group;
  volume: THREE.LineSegments;
  dispose(): void;
}

/**
 * @param holo pattern to use if the plate turns out to be smooth PEI (ignored otherwise)
 */
export function buildPrinterModel(def: PrinterDef, bedType: string, holo: HoloPattern = DEFAULT_HOLO[def.id]): PrinterModel {
  const group = new THREE.Group();
  group.name = 'printer';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  if (!isSmoothPlate(bedType)) holo = 'none';
  const surface = surfaceFor(def.id, bedType, holo);
  const pw = def.max[0] - def.min[0];
  const pd = def.max[1] - def.min[1];

  // ---- plate geometry (per printer)
  const margin = def.id === 'k2plus' ? [4, 4, 4, 6] : def.id === 'a1' ? [3, 3, 3, 6] : [3, 3, 3, 3]; // left right front back
  const plateMin: [number, number] = [def.min[0] - margin[0], def.min[1] - margin[2]];
  const plateSize: [number, number] = [pw + margin[0] + margin[1], pd + margin[2] + margin[3]];
  const radius = def.id === 'a1' ? 6 : 5;
  const shape = roundedRect(plateMin[0], plateMin[1], plateSize[0], plateSize[1], radius);

  if (def.id === 'k2plus') {
    // front pull tab
    const tabW = 46;
    const tabD = 9;
    const cx = (def.min[0] + def.max[0]) / 2;
    const tab = roundedRect(cx - tabW / 2, plateMin[1] - tabD, tabW, tabD + radius, 4);
    const tabGeo = track(new THREE.ExtrudeGeometry(tab, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.4, bevelSegments: 2, curveSegments: 10 }));
    tabGeo.translate(0, 0, -1.25);
    const tabMat = track(new THREE.MeshStandardMaterial({ color: surface.base, roughness: surface.roughness, metalness: surface.metalness }));
    group.add(new THREE.Mesh(tabGeo, tabMat));
  }
  if (def.id === 'a1') {
    // two alignment notches at the back edge
    for (const nx of [def.min[0] + 18, def.max[0] - 18]) {
      const hole = new THREE.Path();
      hole.absarc(nx, plateMin[1] + plateSize[1] - 2.2, 2.2, 0, Math.PI * 2, false);
      shape.holes.push(hole);
    }
  }

  const logo = def.id === 'k2plus' ? 'K2 PLUS' : def.id === 'a1' ? 'A1' : '';
  const tex = track(plateTexture(def, surface, plateMin, plateSize, logo, holo));
  const plateGeo = track(new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.4, bevelSegments: 2, curveSegments: 10 }));
  planarUV(plateGeo, plateMin, plateSize);
  plateGeo.translate(0, 0, -1.2);
  const plateMat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: surface.roughness, metalness: surface.metalness }));
  if (surface.grain > 0) {
    const grain = track(grainTexture());
    grain.repeat.set(plateSize[0] / GRAIN_TILE_MM, plateSize[1] / GRAIN_TILE_MM);
    plateMat.bumpMap = grain;
    plateMat.bumpScale = surface.grain;
  }
  if (holo !== 'none') applyHolo(plateMat, holo, [(def.min[0] + def.max[0]) / 2, (def.min[1] + def.max[1]) / 2]);
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.name = 'plate';
  group.add(plate);

  // ---- heated bed beneath
  const bedMargin = 8;
  const bedShape = roundedRect(plateMin[0] - bedMargin, plateMin[1] - bedMargin, plateSize[0] + bedMargin * 2, plateSize[1] + bedMargin * 2, 3);
  const bedGeo = track(new THREE.ExtrudeGeometry(bedShape, { depth: 5, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2, curveSegments: 6 }));
  bedGeo.translate(0, 0, -7.2);
  const body = BODY[def.id];
  const bedMat = track(new THREE.MeshStandardMaterial({ color: body.bed, roughness: 0.55, metalness: def.id === 'a1' ? 0.15 : 0.5 }));
  group.add(new THREE.Mesh(bedGeo, bedMat));
  const frameMat = track(new THREE.MeshStandardMaterial({ color: body.frame, roughness: 0.6, metalness: def.id === 'a1' ? 0.1 : 0.4 }));
  const box = (w: number, d: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, d, h)), frameMat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const cxBed = (def.min[0] + def.max[0]) / 2;
  const cyBed = (def.min[1] + def.max[1]) / 2;
  if (def.id === 'a1') {
    // Bed slinger: the bed rides on a carriage along a single Y beam that sits on two feet.
    const beamTop = -7.2 - 16;
    box(110, 110, 16, cxBed, cyBed, beamTop + 8); // carriage
    box(46, pd + 170, 26, cxBed, cyBed, beamTop - 13); // Y beam
    box(pw + 60, 46, 20, cxBed, def.min[1] - 85, beamTop - 26 - 10); // front foot
    box(pw + 60, 46, 20, cxBed, def.max[1] + 85, beamTop - 26 - 10); // back foot
  }
  if (def.id === 'k2plus') {
    // Enclosed CoreXY: the bed sits inside a dark frame.
    const out = 34;
    const h = def.height + 40;
    const z0 = -60;
    // back posts and top rail only, so nothing blocks the view from the front
    for (const x of [def.min[0] - out, def.max[0] + out]) box(16, 16, h - z0, x, def.max[1] + out, (h + z0) / 2);
    box(pw + out * 2 + 16, 16, 16, cxBed, def.max[1] + out, h);
    box(pw + out * 2 + 18, pd + out * 2 + 18, 6, cxBed, cyBed, z0); // floor
    box(28, 28, 50, cxBed, def.max[1] + 4, -7.2 - 25); // rear bed arm
  }

  if (def.id === 'a1') {
    // alignment pins sitting in the notches
    const pinGeo = track(new THREE.CylinderGeometry(1.8, 1.8, 3, 20));
    pinGeo.rotateX(Math.PI / 2);
    const pinMat = track(new THREE.MeshStandardMaterial({ color: '#B8BCC2', roughness: 0.3, metalness: 0.9 }));
    for (const nx of [def.min[0] + 18, def.max[0] - 18]) {
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(nx, plateMin[1] + plateSize[1] - 2.2, -0.9);
      group.add(pin);
    }
  }
  if (def.id === 'k2plus') {
    // leveling screws on the bed corners
    const screwGeo = track(new THREE.CylinderGeometry(3, 3, 1.2, 24));
    screwGeo.rotateX(Math.PI / 2);
    const screwMat = track(new THREE.MeshStandardMaterial({ color: '#9A9EA5', roughness: 0.35, metalness: 0.9 }));
    const bx0 = plateMin[0] - bedMargin + 5;
    const by0 = plateMin[1] - bedMargin + 5;
    const bx1 = plateMin[0] + plateSize[0] + bedMargin - 5;
    const by1 = plateMin[1] + plateSize[1] + bedMargin - 5;
    for (const [x, y] of [
      [bx0, by0],
      [bx1, by0],
      [bx0, by1],
      [bx1, by1],
    ]) {
      const s = new THREE.Mesh(screwGeo, screwMat);
      s.position.set(x, y, -1.4);
      group.add(s);
    }
  }

  // ---- build volume outline
  const [x0, y0] = def.min;
  const [x1, y1] = def.max;
  const zt = def.height;
  const v = new Float32Array([
    x0, y0, zt, x1, y0, zt, x1, y0, zt, x1, y1, zt, x1, y1, zt, x0, y1, zt, x0, y1, zt, x0, y0, zt,
    x0, y0, 0, x0, y0, zt, x1, y0, 0, x1, y0, zt, x1, y1, 0, x1, y1, zt, x0, y1, 0, x0, y1, zt,
  ]);
  const volGeo = track(new THREE.BufferGeometry());
  volGeo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  const volMat = track(new THREE.LineBasicMaterial({ color: '#8FA3B8', transparent: true, opacity: 0.22, depthWrite: false }));
  const volume = new THREE.LineSegments(volGeo, volMat);
  volume.name = 'volume';
  group.add(volume);

  return {
    group,
    volume,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
