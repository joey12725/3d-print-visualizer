// Parses real slicer output if present on this machine (set GCODE_SAMPLES to a
// colon-separated list of paths). Prints a summary so regressions are easy to spot.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { GcodeParser } from '../src/lib/gcode/parser';
import { FEATURES } from '../src/lib/gcode/features';

const files = (process.env.GCODE_SAMPLES ?? '').split(':').filter((f) => f && existsSync(f));

describe.skipIf(!files.length)('real G-code files', () => {
  for (const file of files) {
    it(file.split('/').pop()!, () => {
      const t0 = performance.now();
      const text = readFileSync(file, 'utf8');
      const p = new GcodeParser(file, statSync(file).size);
      const CH = 1 << 20;
      for (let i = 0; i < text.length; i += CH) p.feed(text.slice(i, i + CH));
      const r = p.finish();
      const ms = performance.now() - t0;
      const fmt = (s: number) => `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${Math.round(s % 60)}s`;
      console.log(
        JSON.stringify(
          {
            ms: Math.round(ms),
            slicer: r.meta.slicer,
            printer: r.meta.printerModel,
            bed: r.meta.bedType,
            area: r.meta.printableArea,
            layers: r.layers.count,
            reportedLayers: r.meta.layerCountReported,
            firstLayers: Array.from(r.layers.z.slice(0, 4)).map((z, i) => [z, r.layers.height[i]]),
            ext: r.ext.count,
            travel: r.travel.count,
            moves: r.moveCount,
            slicerTime: r.meta.slicerTimeS && fmt(r.meta.slicerTimeS),
            computed: fmt(r.computedTimeS),
            filaments: r.filaments,
            ranges: r.ranges,
            features: r.featureStats.map((f) => `${f.feature < 0 ? 'Travel' : FEATURES[f.feature].name}: ${fmt(f.timeS)} ${(f.filamentMm / 1000).toFixed(2)}m`),
            layerTimes: Array.from(r.layers.time.slice(0, 5)).map((t) => t.toFixed(1)),
            bounds: r.bounds,
            thumb: r.meta.thumbnail?.slice(0, 40),
            warnings: r.warnings,
          },
          null,
          1,
        ),
      );
      expect(r.ext.count).toBeGreaterThan(0);
      expect(r.layers.count).toBeGreaterThan(0);
    }, 120_000);
  }
});
