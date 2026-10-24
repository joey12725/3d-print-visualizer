// Global UI state (Svelte 5 runes). Heavy data lives in `result` as a raw (non-proxied)
// object; everything else is small and reactive.

import type { ParseResult } from './gcode/types';
import type { ParseMessage, ParseRequest } from './gcode/worker';
import ParseWorker from './gcode/worker?worker&inline';
import type { ColorMode, Legend } from './render/colors';
import { detectPrinter, type PrinterId } from './render/printers';
import type { ViewOptions } from './render/viewer';
import { loadPrices, savePrices } from './pricing';
import type { GcodeEntry } from './gcode/source';
import type { SavedShare, ShareManifest } from './share/share';

const PREFS_KEY = 'pv.prefs.v1';

interface Prefs {
  printer: PrinterId | 'auto';
  colorMode: ColorMode;
  options: ViewOptions;
  detailsOpen: boolean;
}

function loadPrefs(): Prefs {
  const d: Prefs = {
    printer: 'auto',
    colorMode: 'feature',
    options: { tubes: true, travels: false, retractions: false, ghost: false, volume: true },
    detailsOpen: false,
  };
  try {
    const s = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { ...d, ...s, options: { ...d.options, ...(s.options ?? {}) } };
  } catch {
    return d;
  }
}

class AppState {
  result = $state.raw<ParseResult | null>(null);
  /** the original dropped file (kept so it can be shared) */
  file = $state.raw<Blob | null>(null);
  fileEntry = $state<string | undefined>(undefined);
  plates = $state.raw<GcodeEntry[] | null>(null);
  choosePlates = $state.raw<GcodeEntry[] | null>(null);
  loading = $state<{ label: string; fraction: number } | null>(null);
  error = $state<string | null>(null);

  printerPref = $state<PrinterId | 'auto'>('auto');
  colorMode = $state<ColorMode>('feature');
  options = $state<ViewOptions>({ tubes: true, travels: false, retractions: false, ghost: false, volume: true });
  legend = $state.raw<Legend | null>(null);
  hidden = $state<Record<number, boolean>>({}); // feature id -> hidden

  layerLo = $state(0);
  layerHi = $state(0);
  /** absolute move index shown at the top of the range (end of the top layer) */
  moveHi = $state(0);
  /** the "Details" section (colour modes, display options, slicer info) */
  detailsOpen = $state(false);

  inspect = $state<{ index: number } | null>(null);
  prices = $state<Record<string, number>>(loadPrices());

  shareManifest = $state.raw<ShareManifest | null>(null);
  share = $state<{ status: 'idle' | 'working' | 'done' | 'error'; label?: string; fraction?: number; result?: SavedShare; error?: string }>({ status: 'idle' });

  private worker: Worker | null = null;

  constructor() {
    const p = loadPrefs();
    this.printerPref = p.printer;
    this.colorMode = p.colorMode;
    this.options = p.options;
    this.detailsOpen = p.detailsOpen;
  }

  get printerId(): PrinterId {
    if (this.printerPref !== 'auto') return this.printerPref;
    if (this.shareManifest?.printer) return this.shareManifest.printer;
    if (this.result) {
      const d = detectPrinter(this.result.meta);
      if (d !== 'generic') return d;
      return this.result.meta.printableArea ? 'generic' : 'k2plus';
    }
    return 'k2plus';
  }

  persist() {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ printer: this.printerPref, colorMode: this.colorMode, options: this.options, detailsOpen: this.detailsOpen } satisfies Prefs),
    );
  }

  setPrices(p: Record<string, number>) {
    this.prices = p;
    savePrices(p);
  }

  /** Visible move range [lo, hi] for the renderer. */
  get moveLo(): number {
    const r = this.result;
    return r && r.layers.count ? r.layers.moveStart[this.layerLo] : 0;
  }

  layerMoveBounds(layer: number): [number, number] {
    const r = this.result;
    if (!r || !r.layers.count) return [0, 0];
    return [r.layers.moveStart[layer], Math.max(r.layers.moveStart[layer], r.layers.moveEnd[layer] - 1)];
  }

  setLayers(lo: number, hi: number, keepMove = false) {
    const r = this.result;
    if (!r || !r.layers.count) return;
    const L = r.layers.count;
    lo = Math.max(0, Math.min(L - 1, Math.round(lo)));
    hi = Math.max(0, Math.min(L - 1, Math.round(hi)));
    if (lo > hi) [lo, hi] = [hi, lo];
    const changedHi = hi !== this.layerHi;
    this.layerLo = lo;
    this.layerHi = hi;
    if (changedHi || !keepMove) this.moveHi = this.layerMoveBounds(hi)[1];
  }

  showAll() {
    const r = this.result;
    if (!r) return;
    this.setLayers(0, r.layers.count - 1);
    this.moveHi = r.moveCount;
  }

  get isFullView() {
    const r = this.result;
    return !!r && this.layerLo === 0 && this.layerHi === r.layers.count - 1 && this.moveHi >= this.layerMoveBounds(this.layerHi)[1];
  }

  async open(file: Blob, name: string, plate?: string) {
    this.error = null;
    this.inspect = null;
    this.choosePlates = null;
    this.loading = { label: `Reading ${name}`, fraction: 0 };
    this.worker?.terminate();
    const w = new ParseWorker();
    this.worker = w;
    const msg = await new Promise<ParseMessage>((resolve) => {
      w.onmessage = (ev: MessageEvent<ParseMessage>) => {
        const m = ev.data;
        if (m.kind === 'progress') {
          if (this.loading) this.loading = { label: `Parsing ${name}`, fraction: m.fraction };
        } else resolve(m);
      };
      w.onerror = (e) => resolve({ kind: 'error', message: e.message || 'The parser crashed' });
      w.postMessage({ file, name, plate } satisfies ParseRequest);
    });
    w.terminate();
    if (this.worker === w) this.worker = null;
    if (msg.kind === 'choose') {
      this.loading = null;
      this.file = file;
      this.choosePlates = msg.plates;
      this.pendingName = name;
      return;
    }
    if (msg.kind === 'error') {
      this.loading = null;
      this.error = msg.message;
      return;
    }
    if (msg.kind !== 'done') return;
    this.loading = { label: 'Building preview', fraction: 1 };
    // let the overlay paint before the GPU upload
    await new Promise((r) => setTimeout(r, 16));
    this.file = file;
    this.fileEntry = msg.entry;
    this.plates = msg.plates ?? null;
    this.pendingName = name;
    this.hidden = {};
    this.share = { status: 'idle' };
    this.result = msg.result;
    this.showAll();
    this.loading = null;
  }

  /** remembered so the plate chooser can re-open the same archive */
  pendingName = '';
}

export const app = new AppState();
