// Filament cost per kilogram, by material. Defaults are typical spool prices;
// anything can be changed in the UI and is remembered in localStorage.

import type { FilamentInfo } from './gcode/types';

export const DEFAULT_PRICES: Record<string, number> = {
  PLA: 14,
  PETG: 15,
  ASA: 19,
  TPU: 19,
};

const KEY = 'pv.prices.v1';

export function loadPrices(): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_PRICES, ...saved };
  } catch {
    return { ...DEFAULT_PRICES };
  }
}

export function savePrices(p: Record<string, number>) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** "PLA Silk", "PLA-CF", "PETG HF", "TPU 95A" -> base material key. */
export function materialKey(type: string): string {
  const t = type.toUpperCase().trim();
  for (const k of ['PETG', 'PLA', 'ASA', 'TPU', 'ABS', 'PA', 'PC']) if (t.startsWith(k)) return k;
  return t || 'PLA';
}

export function filamentCost(f: FilamentInfo, prices: Record<string, number>): number | null {
  const price = prices[materialKey(f.type)];
  if (price === undefined || !Number.isFinite(price)) return null;
  return (f.weightG / 1000) * price;
}
