// "Color by" modes. Each mode turns per-segment attributes into an RGB buffer and a
// legend description. Continuous modes use the same 11-step range palette as
// Bambu Studio / OrcaSlicer so values read the way they do in the slicer.

import { FEATURES } from '../gcode/features';
import type { ParseResult } from '../gcode/types';

export type ColorMode =
  | 'feature'
  | 'filament'
  | 'speed'
  | 'height'
  | 'width'
  | 'flow'
  | 'layerTime'
  | 'layerTimeLog'
  | 'fan'
  | 'temp'
  | 'accel';

export const COLOR_MODES: { id: ColorMode; label: string; short: string }[] = [
  { id: 'feature', label: 'Line type', short: 'Type' },
  { id: 'filament', label: 'Filament', short: 'Filament' },
  { id: 'speed', label: 'Speed', short: 'Speed' },
  { id: 'height', label: 'Layer height', short: 'Height' },
  { id: 'width', label: 'Line width', short: 'Width' },
  { id: 'flow', label: 'Flow', short: 'Flow' },
  { id: 'layerTime', label: 'Layer time', short: 'Layer time' },
  { id: 'layerTimeLog', label: 'Layer time (log)', short: 'Time log' },
  { id: 'fan', label: 'Fan speed', short: 'Fan' },
  { id: 'temp', label: 'Temperature', short: 'Temp' },
  { id: 'accel', label: 'Acceleration', short: 'Accel' },
];

export const RANGE_PALETTE = [
  '#0B2C7A',
  '#135985',
  '#1C8891',
  '#04D60F',
  '#AAF200',
  '#FCF903',
  '#F5CE0A',
  '#E38820',
  '#D16830',
  '#C2523C',
  '#942616',
];

export interface LegendItem {
  color: string;
  label: string;
  /** feature id or tool index for toggleable categorical items */
  key?: number;
  detail?: string;
}

export interface Legend {
  kind: 'categorical' | 'range';
  title: string;
  items: LegendItem[];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return [200, 200, 200];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const PALETTE_RGB = RANGE_PALETTE.map(hexToRgb);

function paletteAt(t: number, out: Uint8Array, o: number) {
  const x = Math.max(0, Math.min(1, t)) * (PALETTE_RGB.length - 1);
  const i = Math.min(PALETTE_RGB.length - 2, Math.floor(x));
  const f = x - i;
  const a = PALETTE_RGB[i];
  const b = PALETTE_RGB[i + 1];
  out[o] = a[0] + (b[0] - a[0]) * f;
  out[o + 1] = a[1] + (b[1] - a[1]) * f;
  out[o + 2] = a[2] + (b[2] - a[2]) * f;
}

/** Very dark filaments (black) would disappear on the dark stage; lift them slightly. */
function visible(rgb: [number, number, number]): [number, number, number] {
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (lum >= 40) return rgb;
  const k = (40 - lum) / 40;
  return [rgb[0] + (58 - rgb[0]) * k, rgb[1] + (60 - rgb[1]) * k, rgb[2] + (66 - rgb[2]) * k];
}

interface RangeSpec {
  title: string;
  unit: string;
  digits: number;
  value: (r: ParseResult, i: number) => number;
  range: (r: ParseResult) => [number, number];
  log?: boolean;
  format?: (v: number) => string;
}

export function formatDuration(s: number, withSeconds = true): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return withSeconds ? `${m}m ${sec}s` : `${m}m`;
}

const RANGE_SPECS: Partial<Record<ColorMode, RangeSpec>> = {
  speed: { title: 'Speed', unit: 'mm/s', digits: 0, value: (r, i) => r.ext.speed[i], range: (r) => r.ranges.speed },
  height: { title: 'Layer height', unit: 'mm', digits: 2, value: (r, i) => r.ext.height[i], range: (r) => r.ranges.height },
  width: { title: 'Line width', unit: 'mm', digits: 2, value: (r, i) => r.ext.width[i], range: (r) => r.ranges.width },
  flow: { title: 'Volumetric flow', unit: 'mm³/s', digits: 1, value: (r, i) => r.ext.flow[i], range: (r) => r.ranges.flow },
  fan: { title: 'Fan speed', unit: '%', digits: 0, value: (r, i) => r.ext.fan[i], range: (r) => r.ranges.fan },
  temp: { title: 'Nozzle temperature', unit: '°C', digits: 0, value: (r, i) => r.ext.temp[i], range: (r) => r.ranges.temp },
  accel: { title: 'Acceleration', unit: 'mm/s²', digits: 0, value: (r, i) => r.ext.accel[i], range: (r) => r.ranges.accel },
  layerTime: {
    title: 'Layer time',
    unit: '',
    digits: 0,
    value: (r, i) => r.layers.time[r.ext.layer[i]],
    range: (r) => r.ranges.layerTime,
    format: (v) => formatDuration(v),
  },
  layerTimeLog: {
    title: 'Layer time (log scale)',
    unit: '',
    digits: 0,
    log: true,
    value: (r, i) => r.layers.time[r.ext.layer[i]],
    range: (r) => r.ranges.layerTime,
    format: (v) => formatDuration(v),
  },
};

export function computeColors(r: ParseResult, mode: ColorMode, out?: Uint8Array): { colors: Uint8Array; legend: Legend } {
  const n = r.ext.count;
  const colors = out && out.length === n * 3 ? out : new Uint8Array(n * 3);

  if (mode === 'feature') {
    const lut = FEATURES.map((f) => hexToRgb(f.color));
    const feat = r.ext.feature;
    for (let i = 0; i < n; i++) {
      const c = lut[feat[i]];
      const o = i * 3;
      colors[o] = c[0];
      colors[o + 1] = c[1];
      colors[o + 2] = c[2];
    }
    const total = r.featureStats.reduce((a, s) => a + s.timeS, 0) || 1;
    const items: LegendItem[] = r.featureStats
      .filter((s) => s.feature >= 0)
      .map((s) => ({
        key: s.feature,
        color: FEATURES[s.feature].color,
        label: FEATURES[s.feature].name,
        detail: `${formatDuration(s.timeS, false)} · ${((s.timeS / total) * 100).toFixed(1)}%`,
      }));
    return { colors, legend: { kind: 'categorical', title: 'Line type', items } };
  }

  if (mode === 'filament') {
    const lut: [number, number, number][] = [];
    for (let t = 0; t < 64; t++) {
      const f = r.filaments.find((x) => x.index === t);
      lut[t] = visible(hexToRgb(f?.color ?? '#E0E0E0'));
    }
    const tool = r.ext.tool;
    for (let i = 0; i < n; i++) {
      const c = lut[tool[i]];
      const o = i * 3;
      colors[o] = c[0];
      colors[o + 1] = c[1];
      colors[o + 2] = c[2];
    }
    const items = r.filaments.map((f) => ({
      key: f.index,
      color: f.color,
      label: `T${f.index + 1} · ${f.type}`,
      detail: `${f.weightG.toFixed(1)} g`,
    }));
    return { colors, legend: { kind: 'categorical', title: 'Filament', items } };
  }

  const spec = RANGE_SPECS[mode]!;
  let [lo, hi] = spec.range(r);
  if (spec.log) {
    lo = Math.max(lo, 0.1);
    hi = Math.max(hi, lo);
  }
  const span = hi - lo;
  const llo = Math.log(lo);
  const lspan = Math.log(hi) - llo;
  for (let i = 0; i < n; i++) {
    const v = spec.value(r, i);
    let t: number;
    if (span <= 1e-9) t = 0.5;
    else if (spec.log) t = lspan > 1e-9 ? (Math.log(Math.max(v, lo)) - llo) / lspan : 0.5;
    else t = (v - lo) / span;
    paletteAt(t, colors, i * 3);
  }
  const fmt = spec.format ?? ((v: number) => `${v.toFixed(spec.digits)}${spec.unit ? ' ' + spec.unit : ''}`);
  const items: LegendItem[] = [];
  if (span <= 1e-9) {
    items.push({ color: RANGE_PALETTE[5], label: fmt(lo) });
  } else {
    for (let k = RANGE_PALETTE.length - 1; k >= 0; k--) {
      const t = k / (RANGE_PALETTE.length - 1);
      const v = spec.log ? Math.exp(llo + lspan * t) : lo + span * t;
      items.push({ color: RANGE_PALETTE[k], label: fmt(v) });
    }
  }
  return { colors, legend: { kind: 'range', title: spec.title, items } };
}
