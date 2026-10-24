// Streaming G-code parser.
//
// Feed it text chunks with `feed()`, then call `finish()` to get a ParseResult. It
// understands the dialects produced by Bambu Studio (A1 and friends), Creality Print /
// OrcaSlicer (Klipper, e.g. K2 Plus), PrusaSlicer and Cura well enough to recover line
// types, widths, layer heights and per-layer timing. Everything else is computed from
// the motion itself, including a Klipper-style lookahead planner for print time.

import { featureFromName, FEATURE_CUSTOM, FEATURES } from './features';
import { GrowF32, GrowU32, GrowU8 } from './grow';
import type { FeatureStat, FilamentInfo, ParseResult, SlicerMeta } from './types';

const DEG_EPS = 1e-9;
const ARC_TOLERANCE = 0.015; // mm chord deviation when flattening G2/G3
const SQRT2_M1 = Math.SQRT2 - 1;

export interface ParserOptions {
  onProgress?: (fraction: number) => void;
}

interface TimeMark {
  move: number;
  elapsed: number;
}

export class GcodeParser {
  // --- machine state ---
  private x = 0;
  private y = 0;
  private z = 0;
  private e = 0;
  private f = 3000; // mm/min
  private absXYZ = true;
  private absE = true;
  private tool = 0;
  private fan = 0;
  private temps = new Float32Array(64);
  private accelPrint = 1500;
  private accelTravel = 1500;
  private scv = 5; // Klipper square_corner_velocity
  private maxVelocity = 0; // from SET_VELOCITY_LIMIT VELOCITY=, 0 = unknown

  // --- slicer annotations ---
  private feature = FEATURE_CUSTOM;
  private width = -1;
  private height = -1;

  // --- layers ---
  private markerLayers = false; // slicer emits explicit layer-change comments
  private pendingMarker = false;
  private markerZSeen = false;
  private layerHasExtrusion = false;
  private layerZ = new GrowF32(1024);
  private layerH = new GrowF32(1024);
  private layerMoveStart = new GrowU32(1024);
  private lastLayerTopZ = 0;

  // --- outputs ---
  private ePos = new GrowF32();
  private eWidth = new GrowF32();
  private eHeight = new GrowF32();
  private eFeature = new GrowU8();
  private eTool = new GrowU8();
  private eSpeed = new GrowF32();
  private eFlow = new GrowF32(); // holds E per mm until finish()
  private eFan = new GrowU8();
  private eTemp = new GrowF32();
  private eAccel = new GrowF32();
  private eLayer = new GrowU32();
  private eMove = new GrowU32();

  private tPos = new GrowF32();
  private tMove = new GrowU32();
  private rPos = new GrowF32();
  private rMove = new GrowU32();

  // --- planner inputs, one entry per move ---
  private mDist = new GrowF32();
  private mVel = new GrowF32(); // commanded mm/s
  private mZRatio = new GrowF32(); // |dz| / dist, used for Z speed limits
  private mAccel = new GrowF32();
  private mJunction = new GrowF32(); // max entry speed² from cornering
  private mExtrude = new GrowU8(); // 1 = extrusion, 0 = travel/other
  private moveCount = 0;
  private prevUx = 0;
  private prevUy = 0;
  private prevUz = 0;
  private prevValid = false;
  private prevDist = 0;
  private dwell = new Map<number, number>();
  private timeMarks: TimeMark[] = [];

  // --- per tool / feature accounting ---
  private toolE = new Float64Array(64);
  private featureE = new Float64Array(FEATURES.length);

  // --- metadata ---
  private kv = new Map<string, string>();
  private slicerName = '';
  private thumbs: { w: number; h: number; mime: string; data: string[] }[] = [];
  private thumbActive: { w: number; h: number; mime: string; data: string[] } | null = null;
  private warnings: string[] = [];

  // --- streaming ---
  private carry = '';
  private bytesSeen = 0;

  // scratch for parameter parsing
  private pv = new Float64Array(26);
  private ph = new Uint8Array(26);
  private numEnd = 0;

  constructor(
    private fileName: string,
    private totalBytes = 0,
    private opts: ParserOptions = {},
  ) {}

  feed(chunk: string) {
    this.bytesSeen += chunk.length;
    let text = this.carry.length ? this.carry + chunk : chunk;
    let start = 0;
    const n = text.length;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) break;
      let end = nl;
      if (end > start && text.charCodeAt(end - 1) === 13) end--;
      if (end > start) this.line(text, start, end);
      start = nl + 1;
    }
    this.carry = start < n ? text.slice(start) : '';
    text = '';
    if (this.opts.onProgress && this.totalBytes) this.opts.onProgress(Math.min(1, this.bytesSeen / this.totalBytes));
  }

  // ------------------------------------------------------------------ line dispatch

  private line(s: string, start: number, end: number) {
    let i = start;
    let c = s.charCodeAt(i);
    while ((c === 32 || c === 9) && i < end) c = s.charCodeAt(++i);
    if (i >= end) return;
    if (c === 59 /* ; */) {
      this.comment(s.slice(i + 1, end));
      return;
    }
    if (this.thumbActive) this.thumbActive = null; // malformed thumbnail block
    // strip trailing comment
    const semi = s.indexOf(';', i);
    if (semi !== -1 && semi < end) end = semi;

    // optional line number "N123 "
    if (c === 78 /* N */) {
      i = this.skipWord(s, i, end);
      c = s.charCodeAt(i);
    }
    const letter = c & ~32; // upper-case
    if (letter === 71 /* G */ || letter === 77 /* M */ || letter === 84 /* T */) {
      const code = this.num(s, i + 1, end);
      const after = this.numEnd;
      // Klipper extended commands such as "M73.2" parse fine; anything followed by a
      // letter/underscore immediately (e.g. "TIMELAPSE_TAKE_FRAME") is a macro.
      const nc = s.charCodeAt(after);
      if (after > i + 1 && !(nc === 95 || (nc >= 65 && nc <= 90))) {
        if (letter === 71) this.gcmd(code, s, after, end);
        else if (letter === 77) this.mcmd(code, s, after, end);
        else this.toolChange(code);
        return;
      }
    }
    this.macro(s, i, end);
  }

  private skipWord(s: string, i: number, end: number) {
    while (i < end && s.charCodeAt(i) !== 32) i++;
    while (i < end && s.charCodeAt(i) === 32) i++;
    return i;
  }

  /** Fast float parse starting at i; sets numEnd. Returns NaN when no digits.
   *  No exponent support on purpose: G-code has none, and "X10E5" must stay two words. */
  private num(s: string, i: number, end: number): number {
    let sign = 1;
    let c = s.charCodeAt(i);
    if (c === 45) {
      sign = -1;
      c = s.charCodeAt(++i);
    } else if (c === 43) c = s.charCodeAt(++i);
    let v = 0;
    let digits = 0;
    while (i < end && c >= 48 && c <= 57) {
      v = v * 10 + (c - 48);
      digits++;
      c = s.charCodeAt(++i);
    }
    if (c === 46 && i < end) {
      c = s.charCodeAt(++i);
      let scale = 0.1;
      while (i < end && c >= 48 && c <= 57) {
        v += (c - 48) * scale;
        scale *= 0.1;
        digits++;
        c = s.charCodeAt(++i);
      }
    }
    this.numEnd = i;
    return digits ? sign * v : NaN;
  }

  /** Parses "X1.2 Y3 E-.5" style words into pv/ph. */
  private params(s: string, i: number, end: number) {
    const ph = this.ph;
    ph.fill(0);
    while (i < end) {
      const c = s.charCodeAt(i);
      const u = c & ~32;
      if (u >= 65 && u <= 90) {
        const v = this.num(s, i + 1, end);
        if (!Number.isNaN(v)) {
          this.pv[u - 65] = v;
          ph[u - 65] = 1;
        }
        i = Math.max(this.numEnd, i + 1);
      } else i++;
    }
  }

  // ------------------------------------------------------------------ G codes

  private gcmd(code: number, s: string, i: number, end: number) {
    switch (code) {
      case 0:
      case 1:
        this.params(s, i, end);
        this.linear();
        return;
      case 2:
      case 3:
        this.params(s, i, end);
        this.arc(code === 2);
        return;
      case 4: {
        this.params(s, i, end);
        const sec = this.ph[15] ? this.pv[15] / 1000 : this.ph[18] ? this.pv[18] : 0; // P ms / S s
        if (sec > 0 && this.moveCount > 0) {
          const k = this.moveCount - 1;
          this.dwell.set(k, (this.dwell.get(k) ?? 0) + sec);
        }
        this.prevValid = false;
        return;
      }
      case 28: {
        this.params(s, i, end);
        const any = this.ph[23] || this.ph[24] || this.ph[25];
        if (!any || this.ph[23]) this.x = 0;
        if (!any || this.ph[24]) this.y = 0;
        if (!any || this.ph[25]) this.z = 0;
        this.prevValid = false;
        return;
      }
      case 90:
        this.absXYZ = true;
        this.absE = true;
        return;
      case 91:
        this.absXYZ = false;
        this.absE = false;
        return;
      case 92: {
        this.params(s, i, end);
        const p = this.pv;
        const h = this.ph;
        if (h[23]) this.x = p[23];
        if (h[24]) this.y = p[24];
        if (h[25]) this.z = p[25];
        if (h[4]) this.e = p[4];
        if (!h[23] && !h[24] && !h[25] && !h[4]) this.e = 0;
        return;
      }
      case 10: // firmware retract
      case 11:
        this.addRetract();
        return;
    }
  }

  // ------------------------------------------------------------------ M codes

  private mcmd(code: number, s: string, i: number, end: number) {
    switch (code) {
      case 82:
        this.absE = true;
        return;
      case 83:
        this.absE = false;
        return;
      case 104:
      case 109: {
        this.params(s, i, end);
        // Bambu uses "M109 S25 H140" where H is the real target.
        const t = this.ph[7] ? this.pv[7] : this.ph[18] ? this.pv[18] : this.ph[17] ? this.pv[17] : NaN;
        if (!Number.isNaN(t)) {
          const tool = this.ph[19] ? this.pv[19] | 0 : this.tool;
          if (tool >= 0 && tool < 64) this.temps[tool] = t;
        }
        if (code === 109) this.prevValid = false;
        return;
      }
      case 106:
      case 107: {
        this.params(s, i, end);
        const p = this.ph[15] ? this.pv[15] | 0 : 0;
        if (p === 0 || p === 1) {
          const v = code === 107 ? 0 : this.ph[18] ? this.pv[18] : 255;
          // Some firmwares accept 0..1, most 0..255.
          this.fan = Math.round(Math.max(0, Math.min(100, v <= 1 && v > 0 && !Number.isInteger(v) ? v * 100 : (v / 255) * 100)));
        }
        return;
      }
      case 204: {
        this.params(s, i, end);
        const h = this.ph;
        const p = this.pv;
        if (h[18]) {
          this.accelPrint = p[18];
          this.accelTravel = p[18];
        }
        if (h[15]) this.accelPrint = p[15];
        if (h[19]) this.accelTravel = p[19];
        return;
      }
      case 400:
        this.prevValid = false;
        return;
    }
  }

  private toolChange(code: number) {
    const t = code | 0;
    if (t >= 0 && t < 64) {
      this.tool = t;
      this.prevValid = false;
    }
  }

  /** Klipper macros: SET_VELOCITY_LIMIT, START_PRINT EXTRUDER_TEMP=..., SET_FAN_SPEED ... */
  private macro(s: string, i: number, end: number) {
    const cmdEnd = s.indexOf(' ', i);
    const name = s.slice(i, cmdEnd === -1 || cmdEnd > end ? end : cmdEnd).toUpperCase();
    if (name === 'SET_VELOCITY_LIMIT') {
      const args = kvArgs(s.slice(i, end));
      if (args.ACCEL) {
        const a = parseFloat(args.ACCEL);
        if (a > 0) {
          this.accelPrint = a;
          this.accelTravel = a;
        }
      }
      if (args.SQUARE_CORNER_VELOCITY) this.scv = parseFloat(args.SQUARE_CORNER_VELOCITY) || this.scv;
      if (args.VELOCITY) this.maxVelocity = parseFloat(args.VELOCITY) || this.maxVelocity;
    } else if (name === 'START_PRINT' || name === 'PRINT_START') {
      const args = kvArgs(s.slice(i, end));
      const t = parseFloat(args.EXTRUDER_TEMP ?? args.HOTEND_TEMP ?? args.EXTRUDER ?? '');
      if (t > 0) this.temps[this.tool] = t;
    } else if (name === 'SET_HEATER_TEMPERATURE') {
      const args = kvArgs(s.slice(i, end));
      const heater = (args.HEATER ?? '').toLowerCase();
      const m = /^extruder(\d*)$/.exec(heater);
      if (m) this.temps[m[1] ? parseInt(m[1]) : 0] = parseFloat(args.TARGET ?? '0') || 0;
    } else if (name === 'M117' || name === 'M118') {
      // display messages
    }
  }

  // ------------------------------------------------------------------ motion

  private linear() {
    const p = this.pv;
    const h = this.ph;
    if (h[5]) this.f = p[5];
    const nx = h[23] ? (this.absXYZ ? p[23] : this.x + p[23]) : this.x;
    const ny = h[24] ? (this.absXYZ ? p[24] : this.y + p[24]) : this.y;
    const nz = h[25] ? (this.absXYZ ? p[25] : this.z + p[25]) : this.z;
    let de = 0;
    if (h[4]) {
      de = this.absE ? p[4] - this.e : p[4];
      this.e = this.absE ? p[4] : this.e + p[4];
    }
    if (!h[23] && !h[24] && !h[25] && !h[4]) return; // feed-rate only
    this.segment(nx, ny, nz, de);
  }

  private arc(clockwise: boolean) {
    const p = this.pv;
    const h = this.ph;
    if (h[5]) this.f = p[5];
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const x1 = h[23] ? (this.absXYZ ? p[23] : x0 + p[23]) : x0;
    const y1 = h[24] ? (this.absXYZ ? p[24] : y0 + p[24]) : y0;
    const z1 = h[25] ? (this.absXYZ ? p[25] : z0 + p[25]) : z0;
    let deTotal = 0;
    if (h[4]) {
      deTotal = this.absE ? p[4] - this.e : p[4];
      this.e = this.absE ? p[4] : this.e + p[4];
    }

    let cx: number;
    let cy: number;
    if (h[8] || h[9]) {
      cx = x0 + (h[8] ? p[8] : 0);
      cy = y0 + (h[9] ? p[9] : 0);
    } else if (h[17]) {
      // R form
      const r = p[17];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const d2 = dx * dx + dy * dy;
      if (d2 < DEG_EPS) return;
      const hh = Math.sqrt(Math.max(0, r * r - d2 / 4)) / Math.sqrt(d2);
      const sgn = (clockwise ? 1 : -1) * (r < 0 ? -1 : 1);
      cx = (x0 + x1) / 2 + sgn * hh * dy;
      cy = (y0 + y1) / 2 - sgn * hh * dx;
    } else {
      this.segment(x1, y1, z1, deTotal);
      return;
    }

    const r = Math.hypot(x0 - cx, y0 - cy);
    let a0 = Math.atan2(y0 - cy, x0 - cx);
    let a1 = Math.atan2(y1 - cy, x1 - cx);
    let sweep: number;
    if (clockwise) {
      if (a1 >= a0 - 1e-9) a1 -= Math.PI * 2;
      sweep = a1 - a0;
    } else {
      if (a1 <= a0 + 1e-9) a1 += Math.PI * 2;
      sweep = a1 - a0;
    }
    // full circle when start == end
    if (Math.abs(x1 - x0) < 1e-6 && Math.abs(y1 - y0) < 1e-6) sweep = clockwise ? -Math.PI * 2 : Math.PI * 2;
    // P = extra full turns (Bambu spiral lift)
    if (h[15] && p[15] > 1) sweep += (clockwise ? -1 : 1) * Math.PI * 2 * (Math.floor(p[15]) - 1);
    if (r < 1e-4) {
      this.segment(x1, y1, z1, deTotal);
      return;
    }
    const maxStep = r > ARC_TOLERANCE ? 2 * Math.acos(1 - ARC_TOLERANCE / r) : Math.PI / 4;
    const n = Math.max(1, Math.min(512, Math.ceil(Math.abs(sweep) / maxStep)));
    const dA = sweep / n;
    const dZ = (z1 - z0) / n;
    const dE = deTotal / n;
    for (let k = 1; k <= n; k++) {
      if (k === n) this.segment(x1, y1, z1, dE);
      else {
        const a = a0 + dA * k;
        this.segment(cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + dZ * k, dE);
      }
    }
  }

  private segment(nx: number, ny: number, nz: number, de: number) {
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const dx = nx - x0;
    const dy = ny - y0;
    const dz = nz - z0;
    const dxy2 = dx * dx + dy * dy;
    const dist = Math.sqrt(dxy2 + dz * dz);
    this.x = nx;
    this.y = ny;
    this.z = nz;
    if (dist < 1e-7 && Math.abs(de) < 1e-7) return;

    const move = this.moveCount++;
    const vel = this.f / 60;
    const extruding = de > 1e-7 && dxy2 > 1e-10;

    if (extruding) this.beforeExtrusion(nz);

    // ---- planner record
    let ux = 0;
    let uy = 0;
    let uz = 0;
    let junction = 0;
    if (dist > 1e-7) {
      ux = dx / dist;
      uy = dy / dist;
      uz = dz / dist;
      if (this.prevValid) {
        const cosTheta = -(ux * this.prevUx + uy * this.prevUy + uz * this.prevUz);
        if (cosTheta < 0.999999) {
          // Klipper's junction model: square-corner-velocity deviation plus a
          // centripetal limit so finely-segmented arcs are not taken at full speed.
          const ct = Math.max(cosTheta, -0.999999);
          const sinHalf = Math.sqrt(0.5 * (1 - ct));
          const cosHalf = Math.sqrt(0.5 * (1 + ct));
          const rj = sinHalf / (1 - sinHalf);
          const a = extruding ? this.accelPrint : this.accelTravel;
          const deviation = rj * this.scv * this.scv * SQRT2_M1;
          const centripetal = 0.5 * Math.min(dist, this.prevDist) * (sinHalf / cosHalf) * a;
          junction = Math.min(deviation, centripetal);
          if (!Number.isFinite(junction)) junction = 1e9;
        }
      }
      this.prevUx = ux;
      this.prevUy = uy;
      this.prevUz = uz;
      this.prevDist = dist;
      this.prevValid = true;
      this.mDist.push(dist);
      this.mZRatio.push(Math.abs(dz) / dist);
    } else {
      // extruder-only move (retract / unretract / prime)
      this.prevValid = false;
      this.mDist.push(Math.abs(de));
      this.mZRatio.push(0);
    }
    this.mVel.push(vel);
    this.mAccel.push(extruding ? this.accelPrint : this.accelTravel);
    this.mJunction.push(junction);
    this.mExtrude.push(extruding ? 1 : 0);

    if (de !== 0) this.toolE[this.tool] += de;

    if (extruding) {
      const h = this.height > 0 ? this.height : this.layerHeightGuess();
      this.ePos.push6(x0, y0, z0, nx, ny, nz);
      this.eWidth.push(this.width);
      this.eHeight.push(h);
      this.eFeature.push(this.feature);
      this.eTool.push(this.tool);
      this.eSpeed.push(vel);
      this.eFlow.push(de / dist);
      this.eFan.push(this.fan);
      this.eTemp.push(this.temps[this.tool]);
      this.eAccel.push(this.accelPrint);
      this.eLayer.push(Math.max(0, this.layerZ.length - 1));
      this.eMove.push(move);
      this.featureE[this.feature] += de;
    } else if (dist > 1e-7) {
      this.tPos.push6(x0, y0, z0, nx, ny, nz);
      this.tMove.push(move);
    } else if (de < 0) {
      this.rPos.push3(nx, ny, nz);
      this.rMove.push(move);
    }
  }

  private addRetract() {
    this.rPos.push3(this.x, this.y, this.z);
    this.rMove.push(Math.max(0, this.moveCount - 1));
  }

  private layerHeightGuess() {
    const n = this.layerH.length;
    if (n) {
      const h = this.layerH.data[n - 1];
      if (h > 0) return h;
    }
    return 0.2;
  }

  /** Layer bookkeeping that happens right before an extrusion is recorded. */
  private beforeExtrusion(z: number) {
    const n = this.layerZ.length;
    if (this.pendingMarker) {
      if (!this.markerZSeen && n) {
        // e.g. Cura ";LAYER:n" without a Z annotation: the first extrusion decides.
        const prev = n > 1 ? this.layerZ.data[n - 2] : 0;
        this.layerZ.data[n - 1] = z;
        if (this.layerH.data[n - 1] <= 0) this.layerH.data[n - 1] = Math.max(0.01, z - prev);
      }
      this.pendingMarker = false;
    }
    if (n === 0) {
      this.openLayer(z, this.height > 0 ? this.height : z > 0 ? z : 0.2);
    } else if (!this.markerLayers && z > this.layerZ.data[n - 1] + 1e-4 && this.layerHasExtrusion) {
      const prevTop = this.layerZ.data[n - 1];
      this.openLayer(z, z - prevTop);
    } else if (!this.markerLayers && !this.layerHasExtrusion && Math.abs(z - this.layerZ.data[n - 1]) > 1e-4) {
      // first extrusion of an auto layer decides its Z
      this.layerZ.data[n - 1] = z;
      this.layerH.data[n - 1] = Math.max(0.01, z - this.lastLayerTopZ);
    }
    this.layerHasExtrusion = true;
  }

  private openLayer(z: number, h: number) {
    const n = this.layerZ.length;
    this.lastLayerTopZ = n ? this.layerZ.data[n - 1] : 0;
    this.layerZ.push(z);
    this.layerH.push(h);
    this.layerMoveStart.push(this.moveCount);
    this.layerHasExtrusion = false;
  }

  private markerLayerChange() {
    const first = !this.markerLayers;
    this.markerLayers = true;
    const n = this.layerZ.length;
    if (first && n) {
      // Extrusions before the first marker (start G-code purge lines) belong to layer 1.
      // Collapse any auto layers created so far into a single first layer.
      if (n > 1) {
        const ext = this.eLayer;
        for (let k = 0; k < ext.length; k++) ext.data[k] = 0;
        this.layerZ.length = 1;
        this.layerH.length = 1;
        this.layerMoveStart.length = 1;
      }
      this.layerH.data[0] = -1;
      this.pendingMarker = true;
      this.markerZSeen = false;
      this.layerHasExtrusion = false;
      return;
    }
    this.openLayer(n ? this.layerZ.data[n - 1] : 0, -1);
    this.pendingMarker = true;
    this.markerZSeen = false;
  }

  private markerZ(z: number) {
    if (!this.pendingMarker) return;
    this.markerZSeen = true;
    const n = this.layerZ.length;
    if (n === 0) {
      this.openLayer(z, z);
      this.pendingMarker = true;
      return;
    }
    this.layerZ.data[n - 1] = z;
    const prev = n > 1 ? this.layerZ.data[n - 2] : 0;
    if (this.layerH.data[n - 1] <= 0) this.layerH.data[n - 1] = Math.max(0.01, z - prev);
  }

  private markerHeight(h: number) {
    this.height = h;
    if (this.pendingMarker && this.layerZ.length) this.layerH.data[this.layerZ.length - 1] = h;
  }

  // ------------------------------------------------------------------ comments

  private comment(raw: string) {
    // thumbnails
    if (this.thumbActive) {
      const t = raw.trim();
      if (/^thumbnail(_\w+)? end/i.test(t)) {
        this.thumbs.push(this.thumbActive);
        this.thumbActive = null;
      } else if (t.length) this.thumbActive.data.push(t);
      return;
    }
    const t = raw.trimStart();
    const c0 = t.charCodeAt(0);

    // Hot path first: the most frequent annotations.
    if (c0 === 87 /* W */) {
      if (t.startsWith('WIDTH:')) {
        this.width = parseFloat(t.slice(6));
        return;
      }
      if (t.startsWith('WIPE')) return;
    } else if (c0 === 84 /* T */) {
      if (t.startsWith('TYPE:')) {
        this.feature = featureFromName(t.slice(5));
        return;
      }
      if (t.startsWith('TIME_ELAPSED:')) {
        const v = parseFloat(t.slice(13));
        if (v >= 0) this.timeMarks.push({ move: this.moveCount, elapsed: v });
        return;
      }
    } else if (c0 === 70 /* F */ && t.startsWith('FEATURE:')) {
      this.feature = featureFromName(t.slice(8));
      return;
    } else if (c0 === 76 /* L */) {
      if (t.startsWith('LINE_WIDTH:')) {
        this.width = parseFloat(t.slice(11));
        return;
      }
      if (t.startsWith('LAYER_CHANGE')) {
        this.markerLayerChange();
        return;
      }
      if (t.startsWith('LAYER_HEIGHT:')) {
        this.markerHeight(parseFloat(t.slice(13)));
        return;
      }
      if (/^LAYER:-?\d+\s*$/.test(t)) {
        // Cura
        this.markerLayerChange();
        return;
      }
    } else if (c0 === 72 /* H */ && t.startsWith('HEIGHT:')) {
      this.markerHeight(parseFloat(t.slice(7)));
      return;
    } else if (c0 === 90 /* Z */) {
      if (t.startsWith('Z:')) {
        this.markerZ(parseFloat(t.slice(2)));
        return;
      }
      if (t.startsWith('Z_HEIGHT:')) {
        this.markerZ(parseFloat(t.slice(9)));
        return;
      }
    } else if (c0 === 67 /* C */ && t.startsWith('CHANGE_LAYER')) {
      this.markerLayerChange();
      return;
    }

    // Everything below is rare (headers, config block).
    if (/^thumbnail(_(PNG|JPG|QOI))? begin/i.test(t)) {
      const m = /^thumbnail(?:_(\w+))? begin (\d+)x(\d+)/i.exec(t);
      const kind = (m?.[1] ?? 'PNG').toUpperCase();
      this.thumbActive = {
        w: m ? parseInt(m[2]) : 0,
        h: m ? parseInt(m[3]) : 0,
        mime: kind === 'JPG' ? 'image/jpeg' : kind === 'QOI' ? 'image/qoi' : 'image/png',
        data: [],
      };
      return;
    }
    if (!this.slicerName) {
      const g = /^generated by (.+?)(?: on \d{4}-\d\d-\d\d.*)?$/i.exec(t);
      if (g) {
        this.slicerName = g[1].replace(/_/g, ' ').trim();
        return;
      }
      const b = /^(BambuStudio|OrcaSlicer|PrusaSlicer|SuperSlicer|Creality_Print|CrealityPrint)\s+([\d.]+)/i.exec(t);
      if (b) {
        this.slicerName = `${b[1].replace('BambuStudio', 'Bambu Studio').replace(/_/g, ' ')} ${b[2]}`;
        return;
      }
    }
    if (t.startsWith('model printing time:')) {
      // "; model printing time: 2h 39m 24s; total estimated time: 2h 45m 41s"
      const [model, rest] = t.slice(20).split(';');
      this.kv.set('model printing time', model.trim());
      if (rest?.includes('total estimated time:')) this.kv.set('total estimated time', rest.split(':')[1].trim());
      return;
    }
    if (t.startsWith('total estimated time:')) {
      this.kv.set('total estimated time', t.slice(21).trim());
      return;
    }
    const m = /^([A-Za-z_][\w \[\]\(\)\^³%/.-]*?)\s*(=|:)\s*(.*)$/.exec(t);
    if (m && m[1].length < 80) {
      const key = m[1].trim().toLowerCase();
      if (!this.kv.has(key) || m[2] === '=') this.kv.set(key, m[3].length > 4000 ? m[3].slice(0, 4000) : m[3]);
    }
  }

  // ------------------------------------------------------------------ finish

  finish(): ParseResult {
    if (this.carry) {
      this.line(this.carry, 0, this.carry.length);
      this.carry = '';
    }
    const kv = this.kv;
    const meta = this.buildMeta();

    // Machine limits for the planner.
    const maxV = firstNum(kv.get('machine_max_speed_x')) || this.maxVelocity || 1000;
    const maxVz = firstNum(kv.get('machine_max_speed_z')) || 20;
    const maxA = firstNum(kv.get('machine_max_acceleration_extruding')) || firstNum(kv.get('machine_max_acceleration_x')) || 0;

    // ---------------- kinematic planning
    const n = this.moveCount;
    const dist = this.mDist.data;
    const vel = this.mVel.data;
    const zr = this.mZRatio.data;
    const acc = this.mAccel.data;
    const jun = this.mJunction.data;
    const vmax2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = Math.min(vel[i], maxV);
      if (zr[i] > 1e-6) v = Math.min(v, maxVz / zr[i]);
      if (v <= 0) v = 1;
      vmax2[i] = v * v;
      let a = acc[i];
      if (maxA > 0 && a > maxA) a = maxA;
      if (!(a > 0)) a = 1000;
      acc[i] = a;
    }
    const entry2 = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const prev = i > 0 ? vmax2[i - 1] : 0;
      entry2[i] = Math.min(jun[i], vmax2[i], prev);
    }
    entry2[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      const lim = entry2[i + 1] + 2 * acc[i] * dist[i];
      if (entry2[i] > lim) entry2[i] = lim;
    }
    for (let i = 0; i < n; i++) {
      const lim = entry2[i] + 2 * acc[i] * dist[i];
      if (entry2[i + 1] > lim) entry2[i + 1] = lim;
    }
    const moveT = new Float32Array(n); // per-move seconds
    let computed = 0;
    for (let i = 0; i < n; i++) {
      const t = trapezoidTime(dist[i], Math.sqrt(entry2[i]), Math.sqrt(entry2[i + 1]), Math.sqrt(vmax2[i]), acc[i]);
      moveT[i] = t;
      computed += t;
    }
    for (const [k, sec] of this.dwell) {
      moveT[k] += sec;
      computed += sec;
    }

    // ---------------- calibrate against the slicer's own estimate
    const slicerTotal = meta.slicerTimeS;
    if (this.timeMarks.length > 2 && slicerTotal) {
      // Piecewise: make each interval between TIME_ELAPSED marks match the slicer.
      const marks = [{ move: 0, elapsed: 0 }, ...this.timeMarks, { move: n, elapsed: slicerTotal }];
      for (let k = 0; k + 1 < marks.length; k++) {
        const a = marks[k].move;
        const b = marks[k + 1].move;
        const target = marks[k + 1].elapsed - marks[k].elapsed;
        if (b <= a || !(target >= 0)) continue;
        let sum = 0;
        for (let i = a; i < b; i++) sum += moveT[i];
        if (sum > 1e-6) {
          const s = target / sum;
          for (let i = a; i < b; i++) moveT[i] *= s;
        } else moveT[b - 1] += target;
      }
    } else if (slicerTotal && computed > 0) {
      const s = slicerTotal / computed;
      for (let i = 0; i < n; i++) moveT[i] *= s;
    }
    const moveTime = new Float32Array(n);
    let acc2 = 0;
    for (let i = 0; i < n; i++) {
      acc2 += moveT[i];
      moveTime[i] = acc2;
    }
    const totalTime = slicerTotal ?? acc2;

    // ---------------- layers
    const L = this.layerZ.length;
    const layerMoveStart = this.layerMoveStart.trim();
    if (L) layerMoveStart[0] = 0; // start G-code belongs to the first layer
    const layerMoveEnd = new Uint32Array(L);
    const layerTime = new Float32Array(L);
    const layerStart = new Float32Array(L);
    for (let l = 0; l < L; l++) {
      const a = layerMoveStart[l];
      const b = l + 1 < L ? layerMoveStart[l + 1] : n;
      layerMoveEnd[l] = b;
      const ta = a > 0 ? moveTime[a - 1] : 0;
      const tb = b > 0 ? moveTime[b - 1] : 0;
      layerStart[l] = ta;
      layerTime[l] = Math.max(0, tb - ta);
    }

    // ---------------- extrusion post-processing
    const count = this.eMove.length;
    const filaments = this.buildFilaments(meta);
    const areaOf = (tool: number) => {
      const f = filaments.find((x) => x.index === tool);
      const d = f?.diameter || 1.75;
      return Math.PI * (d / 2) * (d / 2);
    };
    const areas = new Float32Array(64);
    for (let t = 0; t < 64; t++) areas[t] = areaOf(t);
    const width = this.eWidth.trim();
    const height = this.eHeight.trim();
    const flow = this.eFlow.trim();
    const speed = this.eSpeed.trim();
    const tool = this.eTool.trim();
    const temp = this.eTemp.trim();
    const feature = this.eFeature.trim();
    const eMove = this.eMove.trim();
    const nozzle = meta.nozzleDiameter || 0.4;
    const cfgTemps = numList(kv.get('nozzle_temperature'));
    let fallbackWidths = 0;
    for (let i = 0; i < count; i++) {
      const ePerMm = flow[i];
      const area = ePerMm * areas[tool[i]]; // cross-section mm²
      const h = height[i];
      if (!(width[i] > 0)) {
        let w = area / h + h * (1 - Math.PI / 4);
        if (!Number.isFinite(w) || w <= 0) w = nozzle;
        width[i] = Math.min(w, nozzle * 4);
        fallbackWidths++;
      }
      flow[i] = area * Math.min(speed[i], maxV);
      if (!(temp[i] > 0)) temp[i] = cfgTemps[tool[i]] ?? cfgTemps[0] ?? 0;
    }
    if (fallbackWidths > count * 0.5 && count) this.warnings.push('Line widths were estimated from extrusion amounts (no width annotations in file).');

    // per-feature time & filament
    const featTime = new Float64Array(FEATURES.length);
    for (let i = 0; i < count; i++) featTime[feature[i]] += moveT[eMove[i]];
    let travelTime = 0;
    const extrude = this.mExtrude.data;
    for (let i = 0; i < n; i++) if (!extrude[i]) travelTime += moveT[i];
    const featureStats: FeatureStat[] = [];
    for (let fId = 0; fId < FEATURES.length; fId++) {
      if (featTime[fId] > 0 || this.featureE[fId] > 0) featureStats.push({ feature: fId, timeS: featTime[fId], filamentMm: this.featureE[fId] });
    }
    featureStats.push({ feature: -1, timeS: travelTime, filamentMm: 0 });

    // bounds & ranges (ignore start/end G-code "Custom" moves when there is a real model)
    const pos = this.ePos.trim();
    const hasModel = featureStats.some((s) => s.feature >= 0 && s.feature !== FEATURE_CUSTOM && s.timeS > 0);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const fan = this.eFan.trim();
    const accel = this.eAccel.trim();
    const R: Record<string, [number, number]> = {};
    const keys = ['speed', 'flow', 'width', 'height', 'fan', 'temp', 'accel'] as const;
    const arrays = { speed, flow, width, height, fan, temp, accel };
    for (const k of keys) R[k] = [Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      if (hasModel && feature[i] === FEATURE_CUSTOM) continue;
      const o = i * 6;
      for (let a = 0; a < 3; a++) {
        const v0 = pos[o + a];
        const v1 = pos[o + 3 + a];
        if (v0 < min[a]) min[a] = v0;
        if (v1 < min[a]) min[a] = v1;
        if (v0 > max[a]) max[a] = v0;
        if (v1 > max[a]) max[a] = v1;
      }
      for (const k of keys) {
        const v = arrays[k][i];
        const r = R[k];
        if (v < r[0]) r[0] = v;
        if (v > r[1]) r[1] = v;
      }
    }
    if (!Number.isFinite(min[0])) {
      min[0] = min[1] = min[2] = 0;
      max[0] = max[1] = max[2] = 0;
    }
    for (const k of keys) if (!Number.isFinite(R[k][0])) R[k] = [0, 0];
    let lt0 = Infinity;
    let lt1 = -Infinity;
    for (let l = 0; l < L; l++) {
      const v = layerTime[l];
      if (v < lt0) lt0 = v;
      if (v > lt1) lt1 = v;
    }
    R.layerTime = Number.isFinite(lt0) ? [lt0, lt1] : [0, 0];

    if (count === 0) this.warnings.push('No extrusion moves were found in this file.');

    return {
      fileName: this.fileName,
      meta,
      filaments,
      ext: {
        count,
        pos,
        width,
        height,
        feature,
        tool,
        speed,
        flow,
        fan,
        temp,
        accel,
        layer: this.eLayer.trim(),
        move: eMove,
      },
      travel: { count: this.tMove.length, pos: this.tPos.trim(), move: this.tMove.trim() },
      retract: { count: this.rMove.length, pos: this.rPos.trim(), move: this.rMove.trim() },
      layers: {
        count: L,
        z: this.layerZ.trim(),
        height: this.layerH.trim(),
        moveStart: layerMoveStart,
        moveEnd: layerMoveEnd,
        time: layerTime,
        startTime: layerStart,
      },
      moveCount: n,
      moveTime,
      featureStats,
      totalTimeS: totalTime,
      computedTimeS: computed,
      bounds: { min, max },
      ranges: R,
      warnings: this.warnings,
    };
  }

  private buildMeta(): SlicerMeta {
    const kv = this.kv;
    let slicerTime: number | null = null;
    for (const key of ['total estimated time', 'estimated printing time (normal mode)', 'estimated printing time']) {
      const v = kv.get(key);
      if (v) {
        const s = parseDuration(v);
        if (s > 0) {
          slicerTime = s;
          break;
        }
      }
    }
    if (slicerTime === null && kv.get('time')) {
      const s = parseFloat(kv.get('time')!); // Cura ";TIME:1234"
      if (s > 0) slicerTime = s;
    }
    let area: [number, number][] | null = null;
    const pa = kv.get('printable_area') ?? kv.get('bed_shape');
    if (pa) {
      const pts = pa
        .split(',')
        .map((p) => p.trim().split('x').map(Number) as [number, number])
        .filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (pts.length >= 3) area = pts;
    }
    let thumb: string | null = null;
    const best = this.thumbs.filter((t) => t.mime !== 'image/qoi').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (best) thumb = `data:${best.mime};base64,${best.data.join('')}`;
    const ph = firstNum(kv.get('printable_height')) || firstNum(kv.get('max_print_height'));
    const layerCount = firstNum(kv.get('total layer number')) || firstNum(kv.get('total layers count'));
    return {
      slicer: this.slicerName,
      printerModel: unquote(kv.get('printer_model') ?? ''),
      printerSettingsId: unquote(kv.get('printer_settings_id') ?? ''),
      bedType: unquote(kv.get('curr_bed_type') ?? ''),
      nozzleDiameter: firstNum(kv.get('nozzle_diameter')) || 0.4,
      printableArea: area,
      printableHeight: ph || null,
      slicerTimeS: slicerTime,
      layerCountReported: layerCount || null,
      thumbnail: thumb,
    };
  }

  private buildFilaments(_meta: SlicerMeta): FilamentInfo[] {
    const kv = this.kv;
    const colors = strList(kv.get('filament_colour') ?? kv.get('extruder_colour'), ';');
    const types = strList(kv.get('filament_type'), ';');
    const names = strList(kv.get('filament_settings_id'), ';').map(unquote);
    const dens = numList(kv.get('filament_density'));
    const dias = numList(kv.get('filament_diameter'));
    const usedMm = numList(kv.get('filament used [mm]') ?? kv.get('total filament length [mm]'));
    const usedG = numList(kv.get('filament used [g]') ?? kv.get('total filament weight [g]'));

    const out: FilamentInfo[] = [];
    for (let t = 0; t < 64; t++) {
      const computedMm = this.toolE[t];
      const reportedMm = usedMm.length > 1 ? usedMm[t] : t === this.primaryTool() ? usedMm[0] : undefined;
      const used = (reportedMm ?? 0) > 0.5 || computedMm > 0.5;
      if (!used) continue;
      const density = dens[t] ?? dens[0] ?? 1.24;
      const diameter = dias[t] ?? dias[0] ?? 1.75;
      const lengthMm = reportedMm && reportedMm > 0 ? reportedMm : computedMm;
      const reportedG = usedG.length > 1 ? usedG[t] : t === this.primaryTool() ? usedG[0] : undefined;
      const weightG = reportedG && reportedG > 0 ? reportedG : (lengthMm * Math.PI * (diameter / 2) ** 2 * density) / 1000;
      out.push({
        index: t,
        color: normColor(colors[t] ?? colors[0] ?? ''),
        type: (types[t] ?? types[0] ?? 'PLA').trim() || 'PLA',
        name: names[t] ?? '',
        density,
        diameter,
        lengthMm,
        weightG,
      });
    }
    return out;
  }

  /** The tool used for most extrusion; slicers report single-value totals for it. */
  private primaryTool() {
    let best = 0;
    for (let t = 1; t < 64; t++) if (this.toolE[t] > this.toolE[best]) best = t;
    return best;
  }
}

// ------------------------------------------------------------------ helpers

function trapezoidTime(d: number, ve: number, vx: number, vmax: number, a: number) {
  if (d <= 0) return 0;
  const peak2 = (2 * a * d + ve * ve + vx * vx) / 2;
  if (peak2 <= vmax * vmax) {
    const vp = Math.sqrt(Math.max(peak2, 0));
    return Math.max(0, (vp - ve) / a) + Math.max(0, (vp - vx) / a);
  }
  const da = (vmax * vmax - ve * ve) / (2 * a);
  const dd = (vmax * vmax - vx * vx) / (2 * a);
  return (vmax - ve) / a + (vmax - vx) / a + Math.max(0, d - da - dd) / vmax;
}

function kvArgs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_]+)=("[^"]*"|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toUpperCase()] = m[2].replace(/^"|"$/g, '');
  return out;
}

export function parseDuration(s: string): number {
  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*([dhms])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const v = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    total += u === 'd' ? v * 86400 : u === 'h' ? v * 3600 : u === 'm' ? v * 60 : v;
  }
  if (!matched) {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  }
  return total;
}

function firstNum(s: string | undefined): number {
  if (!s) return 0;
  const v = parseFloat(s.split(/[,;]/)[0]);
  return Number.isFinite(v) ? v : 0;
}

function numList(s: string | undefined): number[] {
  if (!s) return [];
  return s
    .split(/[,;]/)
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v));
}

function strList(s: string | undefined, sep: string): string[] {
  if (!s) return [];
  return s.split(sep).map((v) => v.trim());
}

function unquote(s: string) {
  return s.trim().replace(/^"|"$/g, '');
}

function normColor(c: string): string {
  const m = /#?([0-9a-f]{6})/i.exec(c);
  return m ? `#${m[1].toUpperCase()}` : '#E0E0E0';
}
