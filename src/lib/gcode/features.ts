// Normalized extrusion roles. Colors match Bambu Studio / OrcaSlicer / Creality Print
// so the preview looks the same as it did in the slicer.

export interface FeatureDef {
  id: number;
  name: string;
  color: string;
}

export const FEATURES: FeatureDef[] = [
  { id: 0, name: 'Inner wall', color: '#FFE64D' },
  { id: 1, name: 'Outer wall', color: '#FF7D38' },
  { id: 2, name: 'Overhang wall', color: '#1F1FFF' },
  { id: 3, name: 'Sparse infill', color: '#B03029' },
  { id: 4, name: 'Internal solid infill', color: '#9654CC' },
  { id: 5, name: 'Top surface', color: '#F04040' },
  { id: 6, name: 'Bottom surface', color: '#665CC7' },
  { id: 7, name: 'Ironing', color: '#FF8C69' },
  { id: 8, name: 'Bridge', color: '#4D80BA' },
  { id: 9, name: 'Internal bridge', color: '#66A3EF' },
  { id: 10, name: 'Gap infill', color: '#FFFFFF' },
  { id: 11, name: 'Skirt', color: '#00876E' },
  { id: 12, name: 'Brim', color: '#00876E' },
  { id: 13, name: 'Support', color: '#00FF00' },
  { id: 14, name: 'Support interface', color: '#008000' },
  { id: 15, name: 'Support transition', color: '#004000' },
  { id: 16, name: 'Prime tower', color: '#B3E3AB' },
  { id: 17, name: 'Floating vertical shell', color: '#D9A54A' },
  { id: 18, name: 'Custom', color: '#5ED194' },
];

export const FEATURE_CUSTOM = 18;

const ALIASES: Record<string, number> = {
  'inner wall': 0,
  perimeter: 0,
  'internal perimeter': 0,
  'wall-inner': 0,
  'outer wall': 1,
  'external perimeter': 1,
  'wall-outer': 1,
  'overhang wall': 2,
  'overhang perimeter': 2,
  'sparse infill': 3,
  'internal infill': 3,
  infill: 3,
  fill: 3,
  'internal solid infill': 4,
  'solid infill': 4,
  skin: 4,
  'top surface': 5,
  'top solid infill': 5,
  'bottom surface': 6,
  'bottom solid infill': 6,
  ironing: 7,
  bridge: 8,
  'bridge infill': 8,
  'internal bridge': 9,
  'internal bridge infill': 9,
  'gap infill': 10,
  'gap fill': 10,
  skirt: 11,
  'skirt/brim': 11,
  brim: 12,
  support: 13,
  'support material': 13,
  'support interface': 14,
  'support material interface': 14,
  'support-interface': 14,
  'support transition': 15,
  'prime tower': 16,
  'wipe tower': 16,
  'prime-tower': 16,
  'floating vertical shell': 17,
  custom: 18,
};

export function featureFromName(raw: string): number {
  const key = raw.trim().toLowerCase();
  const hit = ALIASES[key];
  if (hit !== undefined) return hit;
  if (key.includes('outer') || key.includes('external')) return 1;
  if (key.includes('overhang')) return 2;
  if (key.includes('wall') || key.includes('perimeter')) return 0;
  if (key.includes('support') && key.includes('interface')) return 14;
  if (key.includes('support')) return 13;
  if (key.includes('bridge')) return 8;
  if (key.includes('solid')) return 4;
  if (key.includes('infill')) return 3;
  if (key.includes('top')) return 5;
  if (key.includes('bottom')) return 6;
  if (key.includes('tower')) return 16;
  return FEATURE_CUSTOM;
}
