<script lang="ts">
  // Hosts the three.js viewer and keeps it in sync with app state.
  import { onMount } from 'svelte';
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { Viewer, type ViewPreset } from '../render/viewer';
  import { computeColors, formatDuration } from '../render/colors';
  import { resolvePrinter } from '../render/printers';
  import { ogImage } from '../share/ogimage';

  /** px of the canvas covered by overlays (layer slider, timeline, bottom sheet) */
  let { insets = { right: 0, bottom: 0 } }: { insets?: { right: number; bottom: number } } = $props();

  let el: HTMLDivElement;
  let viewer = $state.raw<Viewer | null>(null);
  let colorBuf: Uint8Array | undefined;

  export function resetView() {
    viewer?.resetView();
  }
  export function setView(p: ViewPreset) {
    viewer?.setView(p);
  }

  onMount(() => {
    try {
      viewer = new Viewer(el);
      if (import.meta.env.DEV) (window as unknown as { __viewer: Viewer }).__viewer = viewer;
      const v = viewer;
      app.ogImage = () => {
        const r = app.result;
        const grams = r ? r.filaments.reduce((a, f) => a + f.weightG, 0) : 0;
        const line = [
          r && formatDuration(r.totalTimeS, false),
          grams > 0 && `${grams.toFixed(1)} g`,
          resolvePrinter(app.printerId, r?.meta ?? null).name,
          r?.meta.bedType,
        ];
        return ogImage(v, { title: (r?.fileName ?? 'Print').replace(/\.gcode$/i, ''), line: line.filter(Boolean).join(' · ') });
      };
    } catch (e) {
      app.error = 'WebGL is not available in this browser, so the 3D preview cannot be shown.';
      console.error(e);
    }
    return () => {
      app.ogImage = null;
      viewer?.dispose();
    };
  });

  // printer + plate
  $effect(() => {
    const v = viewer;
    if (!v) return;
    const id = app.printerId;
    const meta = app.result?.meta ?? null;
    v.setPrinter(resolvePrinter(id, meta), meta?.bedType ?? '', app.holoFor(id));
    untrack(() => {
      if (!app.result) v.resetView(false);
    });
  });

  // geometry
  $effect(() => {
    const v = viewer;
    const r = app.result;
    if (!v) return;
    v.setModel(r);
    colorBuf = undefined;
    untrack(() => v.resetView(false));
  });

  // colours + legend
  $effect(() => {
    const v = viewer;
    const r = app.result;
    const mode = app.colorMode;
    if (!v || !r) return;
    const { colors, legend } = computeColors(r, mode, colorBuf);
    colorBuf = colors;
    v.setColors(colors);
    app.legend = legend;
  });

  $effect(() => {
    viewer?.setMoveRange(app.moveLo, app.moveHi);
  });

  $effect(() => {
    viewer?.setInsets(insets.right, insets.bottom);
  });

  $effect(() => {
    const hidden = app.hidden;
    const vis: boolean[] = [];
    for (let i = 0; i < 32; i++) vis[i] = !hidden[i];
    viewer?.setFeatureVisibility(vis);
  });

  $effect(() => {
    viewer?.setOptions({ ...app.options });
  });


  // ---- tap to inspect, double tap / double click to orbit around a point
  let down: { x: number; y: number; t: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  function onPointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
  function onPointerUp(e: PointerEvent) {
    if (!down || !viewer || !e.isPrimary) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 400) return;
    const now = performance.now();
    const isDouble = now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
    lastTap = { t: now, x: e.clientX, y: e.clientY };
    const hit = viewer.pick(e.clientX, e.clientY);
    if (isDouble) {
      if (hit) viewer.focusPoint(hit.point);
      return;
    }
    app.inspect = hit ? { index: hit.index } : null;
  }
</script>

<div class="viewport" bind:this={el} onpointerdown={onPointerDown} onpointerup={onPointerUp} role="img" aria-label="3D print preview. Drag to rotate, pinch or scroll to zoom, tap a line for details."></div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .viewport :global(canvas) {
    display: block;
    outline: none;
  }
</style>
