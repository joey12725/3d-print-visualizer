import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLO, isSmoothPlate, surfaceFor } from '../src/lib/render/printers';

describe('plate surfaces', () => {
  it('detects smooth PEI as written by Bambu Studio and Creality Print', () => {
    expect(isSmoothPlate('High Temp Plate')).toBe(true);
    expect(isSmoothPlate('Smooth PEI Plate')).toBe(true);
    expect(isSmoothPlate('Textured PEI Plate')).toBe(false);
    expect(isSmoothPlate('Cool Plate')).toBe(false);
    expect(isSmoothPlate('')).toBe(false);
  });

  it('defaults to circles on the K2 Plus and crosshatch on the A1', () => {
    expect(DEFAULT_HOLO.k2plus).toBe('circular');
    expect(DEFAULT_HOLO.a1).toBe('crosshatch');
  });

  it('makes smooth plates black and leaves other plates as they were', () => {
    expect(surfaceFor('k2plus', 'High Temp Plate', 'circular').label).toBe('Smooth PEI');
    expect(surfaceFor('a1', 'High Temp Plate', 'none').base).toBe(surfaceFor('k2plus', 'High Temp Plate', 'none').base);
    expect(surfaceFor('a1', 'Textured PEI Plate').label).toBe('Textured PEI');
    expect(surfaceFor('a1', 'Textured PEI Plate').grain).toBeGreaterThan(0);
    expect(surfaceFor('k2plus', 'Cool Plate').label).toBe('Textured PEI');
    // other printers keep their old gold smooth plate unless a holographic pattern is chosen
    expect(surfaceFor('generic', 'High Temp Plate', 'none').base).not.toBe(surfaceFor('generic', 'High Temp Plate', 'crosshatch').base);
  });
});
