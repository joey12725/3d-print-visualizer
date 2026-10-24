// Turns whatever the user dropped (.gcode, .gcode.gz, .gcode.3mf / .3mf, .zip) into a
// stream of G-code text plus an optional thumbnail from the archive.

import { unzipSync } from 'fflate';

export interface GcodeEntry {
  name: string;
  size: number;
}

export interface OpenedSource {
  /** Name shown in the UI. */
  name: string;
  /** Size of the uncompressed G-code if known (for progress). */
  size: number;
  stream: () => ReadableStream<string>;
  thumbnail?: string;
  /** All plates in a multi-plate 3MF (so the UI can offer to switch). */
  plates?: GcodeEntry[];
  /** Which archive entry was opened, if any. */
  entry?: string;
}

const GZIP = [0x1f, 0x8b];
const ZIP = [0x50, 0x4b];

async function head(blob: Blob, n: number) {
  return new Uint8Array(await blob.slice(0, n).arrayBuffer());
}

function textStream(bytes: ReadableStream<Uint8Array>): ReadableStream<string> {
  return bytes.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
}

/**
 * Opens a dropped file. Multi-plate archives return `{ choose }` unless `plateName`
 * says which plate to read.
 */
export async function openSource(blob: Blob, name: string, plateName?: string): Promise<OpenedSource | { choose: GcodeEntry[] }> {
  const magic = await head(blob, 4);
  if (magic[0] === GZIP[0] && magic[1] === GZIP[1]) {
    return {
      name: name.replace(/\.gz$/i, ''),
      size: 0,
      stream: () => textStream(blob.stream().pipeThrough(new DecompressionStream('gzip'))),
    };
  }
  if (magic[0] === ZIP[0] && magic[1] === ZIP[1]) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(buf, {
      filter: (f) => /\.gcode$/i.test(f.name) || /plate_\d+\.png$/i.test(f.name) || /\.png$/i.test(f.name),
    });
    const gcodes = Object.keys(files)
      .filter((k) => /\.gcode$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!gcodes.length) throw new Error('This archive has no sliced G-code inside. In your slicer, use "Export plate sliced file" or "Export G-code".');
    if (gcodes.length > 1 && !plateName) return { choose: gcodes.map((g) => ({ name: g, size: files[g].length })) };
    const pick = plateName && files[plateName] ? plateName : gcodes[0];
    const data = files[pick];
    // Bambu stores the plate preview next to the G-code: Metadata/plate_1.gcode -> plate_1.png
    const pngName = pick.replace(/\.gcode$/i, '.png');
    let thumbnail: string | undefined;
    if (files[pngName]) thumbnail = `data:image/png;base64,${toBase64(files[pngName])}`;
    const base = name.replace(/\.(gcode\.)?3mf$|\.zip$/i, '');
    const plateLabel = gcodes.length > 1 ? ` · ${pick.split('/').pop()!.replace(/\.gcode$/i, '')}` : '';
    return {
      name: `${base}${plateLabel}.gcode`,
      size: data.length,
      thumbnail,
      plates: gcodes.length > 1 ? gcodes.map((g) => ({ name: g, size: files[g].length })) : undefined,
      entry: pick,
      stream: () => {
        // decode in slices so huge plates don't create one giant string
        let off = 0;
        const CH = 1 << 20;
        const dec = new TextDecoder();
        return new ReadableStream<string>({
          pull(ctrl) {
            if (off >= data.length) {
              const tail = dec.decode();
              if (tail) ctrl.enqueue(tail);
              ctrl.close();
              return;
            }
            ctrl.enqueue(dec.decode(data.subarray(off, off + CH), { stream: true }));
            off += CH;
          },
        });
      },
    };
  }
  return { name, size: blob.size, stream: () => textStream(blob.stream()) };
}

function toBase64(bytes: Uint8Array) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

/**
 * Gzipped G-code bytes for sharing. Plain files are compressed on the fly, .gz files are
 * passed through, and archives have the chosen plate extracted first.
 */
export async function gzippedGcode(blob: Blob, entry?: string): Promise<Blob> {
  const magic = await head(blob, 4);
  if (magic[0] === GZIP[0] && magic[1] === GZIP[1]) return blob;
  let source: Blob = blob;
  if (magic[0] === ZIP[0] && magic[1] === ZIP[1]) {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => (entry ? f.name === entry : /\.gcode$/i.test(f.name)) });
    const key = entry && files[entry] ? entry : Object.keys(files)[0];
    if (!key) throw new Error('No G-code found in archive');
    source = new Blob([files[key] as BlobPart]);
  }
  return new Response(source.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
