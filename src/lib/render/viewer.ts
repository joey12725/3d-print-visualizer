// Three.js stage: printer + toolpath, an orbit camera, picking, and render-on-demand so
// phones don't burn battery while nothing moves.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ParseResult } from '../gcode/types';
import { buildPrinterModel, type HoloPattern, type PrinterDef, type PrinterModel } from './printers';
import { FLAT_FRAG, LINE_FRAG, LINE_VERT, POINT_FRAG, POINT_VERT, TRAVEL_VERT, TUBE_FRAG, TUBE_VERT } from './shaders';

export type ViewPreset = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right';

export interface ViewOptions {
  tubes: boolean;
  travels: boolean;
  retractions: boolean;
  ghost: boolean;
  volume: boolean;
}

/** Template for one tube instance: 4-vertex ring at each end plus a cap tip. */
function tubeTemplate() {
  const ring = [
    [0, 1, 0],
    [0, 0, 1],
    [0, -1, 0],
    [0, 0, -1],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const t of [0, 1]) for (const [, y, z] of ring) pos.push(t, y, z), nrm.push(0, y, z);
  pos.push(-1, 0, 0);
  nrm.push(-1, 0, 0);
  pos.push(2, 0, 0);
  nrm.push(1, 0, 0);
  const idx: number[] = [];
  for (let a = 0; a < 4; a++) {
    const b = (a + 1) % 4;
    idx.push(a, 4 + b, 4 + a, a, b, 4 + b); // sides
    idx.push(4 + a, 4 + b, 9); // end cap
    idx.push(b, a, 8); // start cap
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function lineTemplate() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
  return g;
}

export interface PickHit {
  index: number; // extrusion index
  point: THREE.Vector3;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private printer: PrinterModel | null = null;
  private printerDef: PrinterDef | null = null;
  private model: ParseResult | null = null;
  private toolpath = new THREE.Group();
  private tubes: THREE.Mesh | null = null;
  private lines: THREE.LineSegments | null = null;
  private travel: THREE.LineSegments | null = null;
  private retracts: THREE.Points | null = null;
  private pickScene = new THREE.Scene();
  private pickTarget = new THREE.WebGLRenderTarget(1, 1);
  private colorAttr: THREE.InstancedBufferAttribute | null = null;
  private disposables: { dispose(): void }[] = [];

  private uniforms = {
    uRange: { value: new THREE.Vector2(0, Infinity) },
    uVis: { value: new Float32Array(32).fill(1) },
    uGhost: { value: 0 },
    uKey: { value: new THREE.Vector3(-0.35, -0.55, 0.76).normalize() },
  };
  private travelUniforms = {
    uRange: this.uniforms.uRange,
    uColor: { value: new THREE.Color('#5B8DEF').convertLinearToSRGB() }, // shaders output sRGB directly
    uOpacity: { value: 0.55 },
  };
  private pointUniforms = {
    uRange: this.uniforms.uRange,
    uColor: { value: new THREE.Color('#F0569B').convertLinearToSRGB() },
    uSize: { value: 5 },
  };

  private options: ViewOptions = { tubes: true, travels: false, retractions: false, ghost: false, volume: true };
  private dirty = true;
  private raf = 0;
  private resizeObs: ResizeObserver;
  private home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private tween: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number; dur: number } | null = null;
  /** screen space covered by UI (px); the model is framed in what's left */
  private insets = { right: 0, bottom: 0 };
  /** true once the user has moved the camera; until then resizes re-frame the print */
  private userMoved = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 20000);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 4000;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => {
      this.tween = null;
      this.userMoved = true;
    });

    // lights for the printer (the toolpath shades itself)
    this.scene.add(new THREE.HemisphereLight(0xe8eef8, 0x30343a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-150, -250, 400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    fill.position.set(300, 300, 200);
    this.scene.add(fill);

    this.scene.add(this.toolpath);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ public API

  setPrinter(def: PrinterDef, bedType: string, holo: HoloPattern) {
    if (this.printer) {
      this.scene.remove(this.printer.group);
      this.printer.dispose();
    }
    this.printerDef = def;
    this.printer = buildPrinterModel(def, bedType, holo);
    this.printer.volume.visible = this.options.volume;
    this.scene.add(this.printer.group);
    this.requestRender();
  }

  setModel(r: ParseResult | null) {
    this.clearModel();
    this.model = r;
    if (!r || r.ext.count === 0) {
      this.requestRender();
      return;
    }
    const n = r.ext.count;
    const pos = new THREE.InstancedInterleavedBuffer(r.ext.pos, 6);
    const iStart = new THREE.InterleavedBufferAttribute(pos, 3, 0);
    const iEnd = new THREE.InterleavedBufferAttribute(pos, 3, 3);
    const size = new Float32Array(n * 2);
    const meta = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      size[i * 2] = r.ext.width[i];
      size[i * 2 + 1] = r.ext.height[i];
      meta[i * 2] = r.ext.move[i];
      meta[i * 2 + 1] = r.ext.feature[i];
    }
    const iSize = new THREE.InstancedBufferAttribute(size, 2);
    const iMeta = new THREE.InstancedBufferAttribute(meta, 2);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Uint8Array(n * 3).fill(200), 3, true);

    const attach = (g: THREE.InstancedBufferGeometry) => {
      g.setAttribute('iStart', iStart);
      g.setAttribute('iEnd', iEnd);
      g.setAttribute('iSize', iSize);
      g.setAttribute('iMeta', iMeta);
      g.setAttribute('iColor', this.colorAttr!);
      g.instanceCount = n;
      this.disposables.push(g);
      return g;
    };

    const tubeMat = this.track(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG, uniforms: this.uniforms }));
    this.tubes = new THREE.Mesh(attach(tubeTemplate()), tubeMat);
    this.tubes.frustumCulled = false;

    const lineMat = this.track(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms: this.uniforms }));
    this.lines = new THREE.LineSegments(attach(lineTemplate()), lineMat);
    this.lines.frustumCulled = false;

    const pickMat = this.track(
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG, uniforms: this.uniforms, defines: { PICK: 1 } }),
    );
    const pickMesh = new THREE.Mesh(this.tubes.geometry, pickMat);
    pickMesh.frustumCulled = false;
    this.pickScene.add(pickMesh);

    // travels
    if (r.travel.count) {
      const tg = lineTemplate();
      const tb = new THREE.InstancedInterleavedBuffer(r.travel.pos, 6);
      tg.setAttribute('iStart', new THREE.InterleavedBufferAttribute(tb, 3, 0));
      tg.setAttribute('iEnd', new THREE.InterleavedBufferAttribute(tb, 3, 3));
      tg.setAttribute('iMove', new THREE.InstancedBufferAttribute(Float32Array.from(r.travel.move), 1));
      tg.instanceCount = r.travel.count;
      this.disposables.push(tg);
      const tm = this.track(
        new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TRAVEL_VERT, fragmentShader: FLAT_FRAG, uniforms: this.travelUniforms, transparent: true, depthWrite: false }),
      );
      this.travel = new THREE.LineSegments(tg, tm);
      this.travel.frustumCulled = false;
    }
    if (r.retract.count) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(r.retract.pos, 3));
      pg.setAttribute('aMove', new THREE.BufferAttribute(Float32Array.from(r.retract.move), 1));
      this.disposables.push(pg);
      const pm = this.track(new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, uniforms: this.pointUniforms }));
      this.retracts = new THREE.Points(pg, pm);
      this.retracts.frustumCulled = false;
    }
    for (const o of [this.tubes, this.lines, this.travel, this.retracts]) if (o) this.toolpath.add(o);
    this.applyOptions();
    this.setMoveRange(0, r.moveCount);
  }

  setColors(colors: Uint8Array) {
    if (!this.colorAttr) return;
    (this.colorAttr.array as Uint8Array).set(colors);
    this.colorAttr.needsUpdate = true;
    this.requestRender();
  }

  /** Visible moves are [min, max] inclusive (global move indices). */
  setMoveRange(min: number, max: number) {
    this.uniforms.uRange.value.set(min, max);
    const r = this.model;
    if (r && this.tubes) {
      // Skip GPU work for instances past the range end: they are sorted by move index.
      const end = upperBound(r.ext.move, max);
      (this.tubes.geometry as THREE.InstancedBufferGeometry).instanceCount = end;
      (this.lines!.geometry as THREE.InstancedBufferGeometry).instanceCount = end;
    }
    this.requestRender();
  }

  setFeatureVisibility(vis: boolean[]) {
    const v = this.uniforms.uVis.value;
    for (let i = 0; i < 32; i++) v[i] = vis[i] === false ? 0 : 1;
    this.requestRender();
  }

  setOptions(o: Partial<ViewOptions>) {
    this.options = { ...this.options, ...o };
    this.applyOptions();
  }


  /** Tell the viewer how much of the canvas is covered by overlays. */
  setInsets(right: number, bottom: number) {
    if (this.insets.right === right && this.insets.bottom === bottom) return;
    this.insets = { right, bottom };
    this.applyViewOffset();
    if (!this.userMoved) this.resetView(false);
    this.requestRender();
  }

  resetView(animate = true) {
    this.userMoved = false;
    this.computeHome();
    this.flyTo(this.home.pos, this.home.target, animate);
  }

  setView(preset: ViewPreset, animate = true) {
    const { target, radius } = this.focusInfo();
    const d = this.fitDistance(radius);
    const dirs: Record<ViewPreset, THREE.Vector3> = {
      iso: this.isoDir(),
      top: new THREE.Vector3(0, -0.0001, 1),
      front: new THREE.Vector3(0, -1, 0.05),
      back: new THREE.Vector3(0, 1, 0.05),
      left: new THREE.Vector3(-1, 0, 0.05),
      right: new THREE.Vector3(1, 0, 0.05),
    };
    const pos = target.clone().addScaledVector(dirs[preset].normalize(), d);
    this.flyTo(pos, target, animate);
  }

  /** Orbit around a point (double-click / double-tap). */
  focusPoint(p: THREE.Vector3) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.flyTo(p.clone().add(offset), p.clone(), true);
  }

  pick(clientX: number, clientY: number): PickHit | null {
    if (!this.tubes || !this.model) return null;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    this.camera.setViewOffset(rect.width, rect.height, x + this.insets.right / 2, y + this.insets.bottom / 2, 1, 1);
    this.renderer.setRenderTarget(this.pickTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.pickScene, this.camera);
    const px = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, px);
    this.renderer.setRenderTarget(null);
    this.applyViewOffset();
    this.requestRender();
    const id = (px[0] | (px[1] << 8) | (px[2] << 16) | (px[3] << 24)) - 1;
    if (id < 0 || id >= this.model.ext.count) return null;
    const p = this.model.ext.pos;
    const o = id * 6;
    const point = new THREE.Vector3((p[o] + p[o + 3]) / 2, (p[o + 1] + p[o + 4]) / 2, (p[o + 2] + p[o + 5]) / 2 - this.model.ext.height[id] / 2);
    return { index: id, point };
  }

  /**
   * Render the default view of the whole print (all layers, whole plate in frame) at w×h
   * for link previews. Uses the on-screen canvas for one synchronous frame, so it looks
   * exactly like the page; the copy is taken before the browser can paint the odd size.
   */
  snapshot(w: number, h: number): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const range = this.uniforms.uRange.value.clone();
    const ratio = this.renderer.getPixelRatio();
    const cam = this.camera.clone();
    if (this.model) this.setMoveRange(0, this.model.moveCount);
    const { target, radius } = this.focusInfo();
    cam.aspect = w / h;
    cam.clearViewOffset();
    cam.position.copy(target).addScaledVector(this.isoDirFor(w, h), this.fitFor(radius, THREE.MathUtils.degToRad(cam.fov), w / h));
    cam.lookAt(target);
    const dist = cam.position.distanceTo(target);
    cam.near = Math.max(0.1, dist / 500);
    cam.far = dist * 20 + 2000;
    cam.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, cam);
    out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0);
    this.renderer.setPixelRatio(ratio);
    this.setMoveRange(range.x, range.y);
    this.resize();
    return out;
  }

  requestRender() {
    this.dirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.clearModel();
    this.printer?.dispose();
    this.controls.dispose();
    this.pickTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------------ internals

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private clearModel() {
    this.toolpath.clear();
    this.pickScene.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.tubes = this.lines = this.travel = null;
    this.retracts = null;
    this.colorAttr = null;
    this.model = null;
  }

  private applyOptions() {
    const o = this.options;
    if (this.tubes) this.tubes.visible = o.tubes;
    if (this.lines) this.lines.visible = !o.tubes;
    if (this.travel) this.travel.visible = o.travels;
    if (this.retracts) this.retracts.visible = o.retractions;
    if (this.printer) this.printer.volume.visible = o.volume;
    this.uniforms.uGhost.value = o.ghost ? 1 : 0;
    this.requestRender();
  }

  /** What the home view frames: the whole plate (layout matters), plus anything taller. */
  private focusInfo() {
    const r = this.model;
    const def = this.printerDef;
    const hasModel = !!r && r.ext.count > 0;
    if (def) {
      const cx = (def.min[0] + def.max[0]) / 2;
      const cy = (def.min[1] + def.max[1]) / 2;
      const top = hasModel ? r!.bounds.max[2] : 0;
      const target = new THREE.Vector3(cx, cy, top * 0.35);
      // half the plate diagonal plus the plate's margin, so the edges stay in frame
      let radius = Math.hypot(def.max[0] - def.min[0], def.max[1] - def.min[1]) / 2 + 12;
      if (hasModel) {
        const { min, max } = r!.bounds;
        for (const x of [min[0], max[0]])
          for (const y of [min[1], max[1]])
            for (const z of [min[2], max[2]]) radius = Math.max(radius, target.distanceTo(new THREE.Vector3(x, y, z)));
      }
      return { target, radius };
    }
    if (hasModel) {
      const { min, max } = r!.bounds;
      const target = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      return { target, radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 };
    }
    return { target: new THREE.Vector3(), radius: 150 };
  }

  private fitDistance(radius: number) {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const w = Math.max(1, (this.container.clientWidth || 1) - this.insets.right);
    const h = Math.max(1, (this.container.clientHeight || 1) - this.insets.bottom);
    const aspect = w / h;
    // vertical fov shrinks with the uncovered height
    const fovV = 2 * Math.atan(Math.tan(fov / 2) * (h / (this.container.clientHeight || h)));
    return this.fitFor(radius, fovV, aspect);
  }

  private fitFor(radius: number, fov: number, aspect: number) {
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect));
    return radius / Math.sin(fit / 2);
  }

  /** Default camera direction; steeper on tall (phone) screens so the plate fills them. */
  private isoDir() {
    return this.isoDirFor((this.container.clientWidth || 1) - this.insets.right, (this.container.clientHeight || 1) - this.insets.bottom);
  }

  private isoDirFor(w: number, h: number) {
    return (w / h < 0.85 ? new THREE.Vector3(0, -0.5, 0.87) : new THREE.Vector3(0, -0.78, 0.62)).normalize();
  }

  private computeHome() {
    const { target, radius } = this.focusInfo();
    const d = this.fitDistance(radius);
    const dir = this.isoDir();
    this.home.target.copy(target);
    this.home.pos.copy(target).addScaledVector(dir, d);
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.tween = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [pos.clone(), target.clone()],
      t0: performance.now(),
      dur: 550,
    };
    this.requestRender();
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.applyViewOffset();
    if (!this.userMoved && !this.tween) this.resetView(false);
    this.requestRender();
  }

  /** Shift the projection so the framed area is the part of the canvas not under UI. */
  private applyViewOffset() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const { right, bottom } = this.insets;
    if (right || bottom) this.camera.setViewOffset(w, h, right / 2, bottom / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
      const k = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.tween.from[0], this.tween.to[0], k);
      this.controls.target.lerpVectors(this.tween.from[1], this.tween.to[1], k);
      if (t >= 1) this.tween = null;
      this.dirty = true;
    }
    const moved = this.controls.update();
    if (moved || this.dirty) {
      this.dirty = false;
      // keep near/far tight for depth precision
      const dist = this.camera.position.distanceTo(this.controls.target);
      this.camera.near = Math.max(0.1, dist / 500);
      this.camera.far = dist * 20 + 2000;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    }
  };
}

/** First index whose value is > v in a sorted array. */
export function upperBound(a: ArrayLike<number>, v: number) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (a[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
