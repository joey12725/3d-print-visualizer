// Data produced by the G-code parser worker. Everything heavy lives in typed arrays so
// it can be transferred from the worker without copying and uploaded straight to the GPU.

export interface FilamentInfo {
  index: number; // tool / filament slot (T index)
  color: string; // #RRGGBB
  type: string; // PLA, PETG, ...
  name: string; // filament_settings_id entry, if any
  density: number; // g/cm³
  diameter: number; // mm
  lengthMm: number; // filament used (slicer value when available, else computed)
  weightG: number;
}

export interface SlicerMeta {
  slicer: string; // "Bambu Studio 02.07.01.62", "Creality Print 6.3.0.3420", ...
  printerModel: string;
  printerSettingsId: string;
  bedType: string;
  nozzleDiameter: number;
  printableArea: [number, number][] | null; // polygon in bed coordinates (mm)
  printableHeight: number | null;
  slicerTimeS: number | null; // total estimated time reported by the slicer
  layerCountReported: number | null;
  thumbnail: string | null; // data: URL of the largest embedded PNG thumbnail
}

/** Extrusion segments (one instance each when rendering). */
export interface Extrusions {
  count: number;
  pos: Float32Array; // count*6: x0 y0 z0 x1 y1 z1
  width: Float32Array; // mm
  height: Float32Array; // mm (layer height)
  feature: Uint8Array;
  tool: Uint8Array;
  speed: Float32Array; // mm/s (commanded)
  flow: Float32Array; // mm³/s volumetric
  fan: Uint8Array; // part fan 0..100 %
  temp: Float32Array; // nozzle °C
  accel: Float32Array; // mm/s²
  layer: Uint32Array; // layer index
  move: Uint32Array; // global move index (shared timeline with travels)
}

export interface Travels {
  count: number;
  pos: Float32Array; // count*6
  move: Uint32Array;
}

export interface Retractions {
  count: number;
  pos: Float32Array; // count*3
  move: Uint32Array;
}

export interface Layers {
  count: number;
  z: Float32Array; // top Z of the layer
  height: Float32Array;
  moveStart: Uint32Array; // first global move index in layer
  moveEnd: Uint32Array; // one past the last move index
  time: Float32Array; // seconds spent printing the layer
  startTime: Float32Array; // seconds from print start
}

export interface FeatureStat {
  feature: number;
  timeS: number;
  filamentMm: number;
}

export interface ParseResult {
  fileName: string;
  meta: SlicerMeta;
  filaments: FilamentInfo[]; // only filaments actually used
  ext: Extrusions;
  travel: Travels;
  retract: Retractions;
  layers: Layers;
  moveCount: number;
  moveTime: Float32Array; // cumulative seconds at the end of each move
  featureStats: FeatureStat[];
  totalTimeS: number; // best estimate (slicer if present)
  computedTimeS: number; // our own kinematic estimate (unscaled)
  bounds: { min: [number, number, number]; max: [number, number, number] };
  ranges: Record<string, [number, number]>; // min/max of continuous attributes
  warnings: string[];
}
