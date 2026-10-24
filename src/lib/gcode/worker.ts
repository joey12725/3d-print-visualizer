/// <reference lib="webworker" />
// Parses G-code off the main thread and transfers the typed arrays back.

import { GcodeParser } from './parser';
import { openSource } from './source';
import type { ParseResult } from './types';

export type ParseRequest = { file: Blob; name: string; plate?: string };
export type ParseMessage =
  | { kind: 'progress'; fraction: number }
  | { kind: 'choose'; plates: { name: string; size: number }[] }
  | { kind: 'done'; result: ParseResult; entry?: string; plates?: { name: string; size: number }[] }
  | { kind: 'error'; message: string };

const post = (m: ParseMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<ParseRequest>) => {
  const { file, name, plate } = ev.data;
  try {
    const src = await openSource(file, name, plate);
    if ('choose' in src) {
      post({ kind: 'choose', plates: src.choose });
      return;
    }
    let last = 0;
    const parser = new GcodeParser(src.name, src.size, {
      onProgress: (f) => {
        if (f - last > 0.01) {
          last = f;
          post({ kind: 'progress', fraction: f * 0.95 });
        }
      },
    });
    const reader = src.stream().getReader();
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(value);
      // gzip streams have unknown size: show indeterminate-ish progress
      if (!src.size) {
        seen += value.length;
        post({ kind: 'progress', fraction: Math.min(0.9, 1 - 1 / (1 + seen / 3e7)) });
      }
    }
    const result = parser.finish();
    if (!result.meta.thumbnail && src.thumbnail) result.meta.thumbnail = src.thumbnail;
    const transfer: Transferable[] = [];
    for (const group of [result.ext, result.travel, result.retract, result.layers]) {
      for (const v of Object.values(group)) if (ArrayBuffer.isView(v)) transfer.push(v.buffer as ArrayBuffer);
    }
    transfer.push(result.moveTime.buffer as ArrayBuffer);
    post({ kind: 'done', result, entry: src.entry, plates: src.plates }, transfer);
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
