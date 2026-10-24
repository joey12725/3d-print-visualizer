<script lang="ts">
  // Dual-thumb layer range slider. Vertical on desktop (like the slicers), horizontal on
  // phones. Dragging the track between the thumbs moves the whole range.
  import { app } from '../state.svelte';

  let { vertical = true }: { vertical?: boolean } = $props();

  let track = $state<HTMLDivElement>();
  const count = $derived(app.result?.layers.count ?? 0);
  const max = $derived(Math.max(1, count - 1));
  const loPct = $derived((app.layerLo / max) * 100);
  const hiPct = $derived((app.layerHi / max) * 100);

  type Drag = { kind: 'lo' | 'hi' | 'range'; startVal: number; startLo: number; startHi: number; pointer: number };
  let drag: Drag | null = null;

  function valueAt(e: PointerEvent) {
    const r = track!.getBoundingClientRect();
    const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(1, f)) * max;
  }

  function start(e: PointerEvent, kind?: 'lo' | 'hi') {
    if (!count) return;
    e.preventDefault();
    e.stopPropagation();
    const v = valueAt(e);
    let k: Drag['kind'];
    if (kind) k = kind;
    else if (v > app.layerLo + 0.5 && v < app.layerHi - 0.5 && app.layerHi - app.layerLo > 2) k = 'range';
    else k = Math.abs(v - app.layerLo) < Math.abs(v - app.layerHi) ? 'lo' : 'hi';
    drag = { kind: k, startVal: v, startLo: app.layerLo, startHi: app.layerHi, pointer: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    move(e);
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const v = valueAt(e);
    if (drag.kind === 'lo') app.setLayers(Math.min(v, app.layerHi), app.layerHi, true);
    else if (drag.kind === 'hi') app.setLayers(app.layerLo, Math.max(v, app.layerLo));
    else {
      const span = drag.startHi - drag.startLo;
      let lo = drag.startLo + (v - drag.startVal);
      lo = Math.max(0, Math.min(max - span, lo));
      app.setLayers(lo, lo + span);
    }
  }

  function end(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointer) drag = null;
  }

  function key(e: KeyboardEvent, which: 'lo' | 'hi') {
    const step = e.shiftKey ? 10 : 1;
    let d = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = -step;
    else if (e.key === 'Home') d = -Infinity;
    else if (e.key === 'End') d = Infinity;
    else return;
    e.preventDefault();
    e.stopPropagation();
    const clamp = (x: number) => (Number.isFinite(x) ? x : x < 0 ? 0 : max);
    if (which === 'lo') app.setLayers(Math.min(clamp(app.layerLo + d), app.layerHi), app.layerHi, true);
    else app.setLayers(app.layerLo, Math.max(clamp(app.layerHi + d), app.layerLo));
  }

  const zOf = (l: number) => app.result?.layers.z[l] ?? 0;
  // the track is inset 14px at both ends; labels follow the thumbs
  // (horizontal labels slide from left- to right-aligned so they never leave the screen)
  const labelPos = (pct: number) =>
    vertical ? `bottom:calc(14px + (100% - 28px) * ${pct / 100})` : `left:calc(14px + (100% - 28px) * ${pct / 100});transform:translateX(-${pct}%)`;
</script>

{#if count}
  <div class="slider" class:vertical class:horizontal={!vertical}>
    <div class="label hi" style={labelPos(hiPct)}>
      <b>{app.layerHi + 1}</b><span>{zOf(app.layerHi).toFixed(2)}</span>
    </div>
    <div class="track" bind:this={track} onpointerdown={(e) => start(e)} onpointermove={move} onpointerup={end} onpointercancel={end} role="presentation">
      <div class="rail"></div>
      <div class="fill" style={vertical ? `bottom:${loPct}%;top:${100 - hiPct}%` : `left:${loPct}%;right:${100 - hiPct}%`}></div>
      <button
        class="thumb lo"
        style={vertical ? `bottom:${loPct}%` : `left:${loPct}%`}
        aria-label="Lowest visible layer"
        aria-valuenow={app.layerLo + 1}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={count}
        onpointerdown={(e) => start(e, 'lo')}
        onkeydown={(e) => key(e, 'lo')}
      ></button>
      <button
        class="thumb hi"
        style={vertical ? `bottom:${hiPct}%` : `left:${hiPct}%`}
        aria-label="Highest visible layer"
        aria-valuenow={app.layerHi + 1}
        role="slider"
        aria-valuemin={1}
        aria-valuemax={count}
        onpointerdown={(e) => start(e, 'hi')}
        onkeydown={(e) => key(e, 'hi')}
      ></button>
    </div>
    {#if app.layerLo > 0 || !vertical}
      <div class="label lo" style={labelPos(loPct)}>
        <b>{app.layerLo + 1}</b><span>{zOf(app.layerLo).toFixed(2)}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .slider {
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  .vertical {
    height: 100%;
    width: 64px;
  }
  .horizontal {
    width: 100%;
    height: 50px;
  }
  .track {
    position: absolute;
    cursor: pointer;
    touch-action: none;
  }
  .vertical .track {
    top: 14px;
    bottom: 14px;
    right: 8px;
    width: 30px;
  }
  .horizontal .track {
    left: 14px;
    right: 14px;
    bottom: 0;
    height: 30px;
  }
  .rail,
  .fill {
    position: absolute;
    border-radius: 99px;
  }
  .rail {
    background: rgba(255, 255, 255, 0.12);
  }
  .vertical .rail {
    left: 13px;
    width: 4px;
    top: 0;
    bottom: 0;
  }
  .horizontal .rail {
    top: 13px;
    height: 4px;
    left: 0;
    right: 0;
  }
  .fill {
    background: var(--accent);
    box-shadow: 0 0 12px rgba(45, 212, 191, 0.35);
  }
  .vertical .fill {
    left: 13px;
    width: 4px;
  }
  .horizontal .fill {
    top: 13px;
    height: 4px;
  }
  .thumb {
    position: absolute;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    padding: 0;
    cursor: grab;
    touch-action: none;
  }
  .thumb:focus-visible {
    outline: 3px solid rgba(45, 212, 191, 0.5);
    outline-offset: 2px;
  }
  .thumb.lo {
    background: #c9d3dd;
  }
  .vertical .thumb {
    left: 4px;
    transform: translateY(50%);
  }
  .horizontal .thumb {
    top: 4px;
    transform: translateX(-50%);
  }
  .label {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 11px;
    line-height: 1.15;
    color: var(--muted);
    pointer-events: none;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .label b {
    color: var(--text);
    font-size: 13px;
    font-weight: 650;
  }
  .vertical .label {
    right: 46px;
    transform: translateY(50%);
    background: rgba(18, 22, 28, 0.82);
    border: 1px solid var(--line);
    padding: 3px 7px;
    border-radius: 7px;
  }
  .horizontal .label {
    top: 0;
    flex-direction: row;
    gap: 5px;
    align-items: baseline;
  }
  .horizontal .label.lo {
    display: none;
  }
</style>
