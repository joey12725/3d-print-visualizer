// The procedural sample plate, written in each slicer's annotation style, should parse
// to the same print: same layers, same line types, the right printer and filaments.
import { describe, expect, it } from 'vitest';
import { GcodeParser } from '../src/lib/gcode/parser';
import { FEATURES } from '../src/lib/gcode/features';
import { detectPrinter, genericPrinter } from '../src/lib/render/printers';
import { FLAVORS, sampleGcode } from '../scripts/sample-gcode';

const feature = (name: string) => FEATURES.findIndex((f) => f.name === name);

function parse(text: string) {
  const p = new GcodeParser('sample.gcode', text.length);
  const CH = 1 << 16;
  for (let i = 0; i < text.length; i += CH) p.feed(text.slice(i, i + CH));
  return p.finish();
}

const results = Object.fromEntries(FLAVORS.map((f) => [f, parse(sampleGcode(f))]));

describe.each(FLAVORS)('sample plate, %s style', (flavor) => {
  const r = results[flavor];

  it('has every layer and a sane time estimate', () => {
    expect(r.layers.count).toBe(300);
    expect(r.layers.z[0]).toBeCloseTo(0.2, 4);
    expect(r.layers.z[299]).toBeCloseTo(60, 3);
    expect(r.totalTimeS).toBeGreaterThan(30 * 60);
    expect(r.totalTimeS).toBeLessThan(10 * 3600);
  });

  it('finds walls, infill and first-layer brim', () => {
    const seen = new Set(r.ext.feature);
    expect(seen.has(feature('Outer wall'))).toBe(true);
    expect(seen.has(feature('Inner wall'))).toBe(true);
    expect(seen.has(feature('Sparse infill'))).toBe(true);
    const brim = flavor === 'cura' || flavor === 'prusa' ? 'Skirt' : 'Brim';
    const first = Array.from(r.ext.feature).findIndex((f) => f === feature(brim));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(r.ext.layer[first]).toBe(0);
  });

  it('keeps every extrusion on the bed', () => {
    const area = genericPrinter(r.meta);
    expect(r.bounds.min[0]).toBeGreaterThan(area.min[0]);
    expect(r.bounds.max[1]).toBeLessThan(flavor === 'orca' ? 350 : area.max[1]);
  });
});

describe('sample plate metadata', () => {
  it('detects the printer from the header', () => {
    expect(detectPrinter(results.bambu.meta)).toBe('a1');
    expect(detectPrinter(results.orca.meta)).toBe('k2plus');
    expect(detectPrinter(results.prusa.meta)).toBe('generic');
    expect(genericPrinter(results.prusa.meta).max).toEqual([250, 210]);
  });

  it('splits filament by tool on two-color plates', () => {
    for (const f of ['bambu', 'orca', 'prusa'] as const) {
      const fil = results[f].filaments;
      expect(fil.map((x) => x.index)).toEqual([0, 1]);
      expect(fil[0].weightG).toBeGreaterThan(fil[1].weightG);
      expect(fil[1].weightG).toBeGreaterThan(1);
    }
    expect(results.bambu.filaments.map((f) => f.color)).toEqual(['#F2A93B', '#2F8F9D']);
    expect(results.cura.filaments).toHaveLength(1);
  });
});
