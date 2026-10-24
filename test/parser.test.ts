import { describe, expect, it } from 'vitest';
import { GcodeParser, parseDuration } from '../src/lib/gcode/parser';
import { FEATURES } from '../src/lib/gcode/features';
import { computeColors, COLOR_MODES } from '../src/lib/render/colors';
import { filamentCost, materialKey } from '../src/lib/pricing';

function parse(text: string, chunk = 7) {
  const p = new GcodeParser('t.gcode');
  // feed in awkward chunk sizes to exercise line stitching
  for (let i = 0; i < text.length; i += chunk) p.feed(text.slice(i, i + chunk));
  return p.finish();
}

const feature = (name: string) => FEATURES.findIndex((f) => f.name === name);

describe('GcodeParser', () => {
  it('handles Orca/Creality style layers, widths and absolute E', () => {
    const r = parse(
      [
        'M82',
        ';LAYER_CHANGE',
        ';Z:0.2',
        ';HEIGHT:0.2',
        'G1 Z0.2 F600',
        ';TYPE:Outer wall',
        ';WIDTH:0.45',
        'G1 X10 Y0 E1 F3000',
        'G1 X10 Y10 E2',
        'G1 E1.2 F2400 ; retract',
        'G1 X0 Y10 F9000',
        'G1 E2 ; unretract',
        ';LAYER_CHANGE',
        ';Z:0.4',
        ';HEIGHT:0.2',
        'G1 Z0.4',
        ';TYPE:Sparse infill',
        'G1 X0 Y0 E3',
        '; estimated printing time (normal mode) = 1m 2s',
        '; filament_type = PETG',
        '; filament_colour = #FF0000',
        '',
      ].join('\n'),
    );
    expect(r.layers.count).toBe(2);
    expect(Array.from(r.layers.z)).toEqual([expect.closeTo(0.2, 5), expect.closeTo(0.4, 5)]);
    expect(r.ext.count).toBe(3);
    expect(r.ext.feature[0]).toBe(feature('Outer wall'));
    expect(r.ext.feature[2]).toBe(feature('Sparse infill'));
    expect(r.ext.width[0]).toBeCloseTo(0.45);
    expect(r.ext.layer[2]).toBe(1);
    expect(r.retract.count).toBe(1);
    expect(r.travel.count).toBeGreaterThan(0);
    expect(r.meta.slicerTimeS).toBe(62);
    expect(r.totalTimeS).toBe(62);
    expect(r.filaments).toHaveLength(1);
    expect(r.filaments[0].type).toBe('PETG');
    expect(r.filaments[0].color).toBe('#FF0000');
    expect(r.filaments[0].lengthMm).toBeCloseTo(3, 5); // net E
  });

  it('handles Bambu style markers, relative E and arcs', () => {
    const r = parse(
      [
        'M83',
        '; FEATURE: Custom',
        'G1 X5 Y1 E3 F1000 ; purge line before first layer',
        '; CHANGE_LAYER',
        '; Z_HEIGHT: 0.2',
        '; LAYER_HEIGHT: 0.2',
        '; FEATURE: Inner wall',
        '; LINE_WIDTH: 0.42',
        'G1 X20 Y10 Z0.2 F12000',
        'G2 X20 Y10 I5 J0 E1.5 F6000 ; full circle',
        'M106 P1 S128',
        'G3 X30 Y10 I5 J0 E0.5',
        'T1',
        'G1 X40 Y10 E4',
        '; model printing time: 1m; total estimated time: 2m 5s',
        '',
      ].join('\n'),
    );
    expect(r.layers.count).toBe(1); // the purge line joins layer 1
    expect(r.ext.layer.every((l) => l === 0)).toBe(true);
    expect(r.meta.slicerTimeS).toBe(125);
    // full circle is flattened into many segments that end where they started
    const circle = Array.from(r.ext.feature).filter((f) => f === feature('Inner wall')).length;
    expect(circle).toBeGreaterThan(20);
    const last = r.ext.count - 1;
    expect(r.ext.pos[last * 6 + 3]).toBeCloseTo(40);
    expect(r.ext.tool[last]).toBe(1);
    expect(r.ext.fan[last]).toBe(50);
    expect(r.filaments.map((f) => f.index)).toEqual([0, 1]);
  });

  it('creates layers from Z changes when there are no markers', () => {
    const r = parse(['G1 Z0.3 F600', 'G1 X10 E1', 'G1 Z0.5', 'G1 X0 E2', 'G1 Z0.7', 'G1 X10 E3', ''].join('\n'));
    expect(r.layers.count).toBe(3);
    expect(r.layers.height[1]).toBeCloseTo(0.2);
  });

  it('computes a positive kinematic time and per-layer times', () => {
    const lines = ['M83', 'M204 S5000'];
    for (let l = 0; l < 3; l++) {
      lines.push(';LAYER_CHANGE', `;Z:${0.2 * (l + 1)}`, ';TYPE:Outer wall');
      for (let i = 0; i < 50; i++) lines.push(`G1 X${i % 2 ? 100 : 0} Y${i} E1 F6000`);
    }
    const r = parse(lines.join('\n') + '\n', 64);
    expect(r.computedTimeS).toBeGreaterThan(0);
    const sum = Array.from(r.layers.time).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.totalTimeS, 3);
    expect(r.moveTime[r.moveCount - 1]).toBeCloseTo(r.totalTimeS, 3);
  });

  it('every color mode produces finite colors and a legend', () => {
    const r = parse([';LAYER_CHANGE', ';Z:0.2', 'G1 X10 E1 F3000', 'G1 X20 E1 F6000', ';LAYER_CHANGE', ';Z:0.4', 'G1 X0 E1', ''].join('\n'));
    for (const m of COLOR_MODES) {
      const { colors, legend } = computeColors(r, m.id);
      expect(colors.length).toBe(r.ext.count * 3);
      expect(legend.items.length).toBeGreaterThan(0);
    }
  });
});

describe('helpers', () => {
  it('parses slicer durations', () => {
    expect(parseDuration('5h 9m 2s')).toBe(5 * 3600 + 9 * 60 + 2);
    expect(parseDuration('1d 2h')).toBe(93600);
    expect(parseDuration('53m22s')).toBe(53 * 60 + 22);
  });
  it('prices filaments by material', () => {
    const prices = { PLA: 14, PETG: 15, ASA: 19, TPU: 19 };
    expect(materialKey('PLA Silk')).toBe('PLA');
    expect(materialKey('PETG-CF')).toBe('PETG');
    expect(materialKey('TPU 95A')).toBe('TPU');
    const f = { index: 0, color: '#fff', type: 'PLA', name: '', density: 1.24, diameter: 1.75, lengthMm: 0, weightG: 500 };
    expect(filamentCost(f, prices)).toBeCloseTo(7);
    expect(filamentCost({ ...f, type: 'ABS' }, prices)).toBeNull();
  });
});
