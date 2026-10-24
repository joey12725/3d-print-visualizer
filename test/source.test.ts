import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { openSource } from '../src/lib/gcode/source';

async function readAll(stream: ReadableStream<string>) {
  let s = '';
  const r = stream.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) return s;
    s += value;
  }
}

describe('openSource', () => {
  it('reads plain G-code', async () => {
    const src = await openSource(new Blob(['G1 X1\n']), 'a.gcode');
    if ('choose' in src) throw new Error('unexpected');
    expect(await readAll(src.stream())).toBe('G1 X1\n');
  });

  it('reads gzipped G-code', async () => {
    const gz = await new Response(new Blob(['G1 X2\n']).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const src = await openSource(gz, 'a.gcode.gz');
    if ('choose' in src) throw new Error('unexpected');
    expect(src.name).toBe('a.gcode');
    expect(await readAll(src.stream())).toBe('G1 X2\n');
  });

  it('asks which plate to open in a multi-plate 3MF, then opens it', async () => {
    const zip = zipSync({
      'Metadata/plate_1.gcode': strToU8('; plate 1\n'),
      'Metadata/plate_2.gcode': strToU8('; plate 2\n'),
      'Metadata/plate_2.png': new Uint8Array([137, 80, 78, 71]),
      '3D/3dmodel.model': strToU8('<model/>'),
    });
    const blob = new Blob([zip as BlobPart]);
    const first = await openSource(blob, 'job.gcode.3mf');
    expect('choose' in first && first.choose.map((p) => p.name)).toEqual(['Metadata/plate_1.gcode', 'Metadata/plate_2.gcode']);
    const second = await openSource(blob, 'job.gcode.3mf', 'Metadata/plate_2.gcode');
    if ('choose' in second) throw new Error('unexpected');
    expect(await readAll(second.stream())).toBe('; plate 2\n');
    expect(second.thumbnail).toMatch(/^data:image\/png;base64,/);
    expect(second.name).toBe('job · plate_2.gcode');
  });
});
