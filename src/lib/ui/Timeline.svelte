<script lang="ts">
  // Move scrubber for the top visible layer plus real-time-based playback.
  import { untrack } from 'svelte';
  import { app } from '../state.svelte';
  import { formatDuration } from '../render/colors';
  import { upperBound } from '../render/viewer';
  import Icon from './Icon.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const r = $derived(app.result);
  const bounds = $derived(r ? app.layerMoveBounds(app.layerHi) : [0, 0]);
  const span = $derived(Math.max(1, bounds[1] - bounds[0]));
  const value = $derived(Math.min(bounds[1], Math.max(bounds[0], app.moveHi)));
  const pct = $derived(((value - bounds[0]) / span) * 100);
  const elapsed = $derived(r && r.moveCount ? r.moveTime[Math.min(r.moveCount - 1, Math.max(0, app.moveHi))] : 0);
  const SPEEDS = [20, 50, 200, 1000, 5000];

  let raf = 0;
  let playClock = 0;
  let playStart = 0;

  function frame(now: number) {
    if (!app.playing || !r) return;
    const t = playClock + ((now - playStart) / 1000) * app.playSpeed;
    let idx = upperBound(r.moveTime, t);
    if (idx >= r.moveCount) {
      app.setLayers(app.layerLo, r.layers.count - 1);
      app.moveHi = r.moveCount;
      app.playing = false;
      return;
    }
    // advance through layers as the virtual nozzle climbs
    let hi = app.layerHi;
    while (hi < r.layers.count - 1 && idx >= r.layers.moveEnd[hi]) hi++;
    if (hi !== app.layerHi) app.setLayers(app.layerLo, hi);
    app.moveHi = idx;
    raf = requestAnimationFrame(frame);
  }

  function toggle() {
    if (!r) return;
    if (app.playing) {
      app.playing = false;
      return;
    }
    // restart from the bottom when already at the end
    if (app.isFullView) {
      app.setLayers(0, 0);
      app.moveHi = 0;
    }
    playClock = app.moveHi > 0 ? r.moveTime[Math.min(app.moveHi, r.moveCount - 1)] : 0;
    playStart = performance.now();
    app.playing = true;
  }

  $effect(() => {
    if (app.playing) {
      // re-anchor the clock when speed changes
      void app.playSpeed;
      untrack(() => {
        const res = app.result;
        if (!res) return;
        playClock = app.moveHi > 0 ? (res.moveTime[Math.min(app.moveHi, res.moveCount - 1)] ?? 0) : 0;
        playStart = performance.now();
      });
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    }
  });

  let scrub = $state<HTMLDivElement>();
  let dragging = false;
  function setFrom(e: PointerEvent) {
    const rect = scrub!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    app.moveHi = Math.round(bounds[0] + f * span);
  }
  function down(e: PointerEvent) {
    e.preventDefault();
    app.playing = false;
    dragging = true;
    scrub!.setPointerCapture(e.pointerId);
    setFrom(e);
  }
  function moveP(e: PointerEvent) {
    if (dragging) setFrom(e);
  }
  function up() {
    dragging = false;
  }
  function step(d: number) {
    app.playing = false;
    const next = Math.max(bounds[0], Math.min(bounds[1], app.moveHi + d));
    app.moveHi = next;
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(app.playSpeed);
    app.playSpeed = SPEEDS[(i + 1) % SPEEDS.length];
    app.persist();
  }
</script>

{#if r}
  <div class="timeline" class:compact>
    <button class="icon play" onclick={toggle} aria-label={app.playing ? 'Pause' : 'Play print simulation'} title="Play / pause (Space)">
      <Icon name={app.playing ? 'pause' : 'play'} size={18} />
    </button>
    <button class="speed" onclick={cycleSpeed} title="Playback speed (relative to real print time)">{app.playSpeed}×</button>
    {#if !compact}
      <button class="icon small" onclick={() => step(-1)} aria-label="Previous move" title="Previous move (←)"><Icon name="skipBack" size={14} /></button>
    {/if}
    <div class="scrub" bind:this={scrub} onpointerdown={down} onpointermove={moveP} onpointerup={up} onpointercancel={up} role="slider" aria-label="Moves in top layer" aria-valuenow={value} tabindex="-1">
      <div class="rail"><div class="fill" style={`width:${pct}%`}></div></div>
      <div class="knob" style={`left:${pct}%`}></div>
    </div>
    {#if !compact}
      <button class="icon small" onclick={() => step(1)} aria-label="Next move" title="Next move (→)"><Icon name="skipForward" size={14} /></button>
    {/if}
    <div class="readout">
      <span class="t">{formatDuration(elapsed, false)}</span><span class="of">/ {formatDuration(r.totalTimeS, false)}</span>
    </div>
    {#if !app.isFullView}
      <button class="all" onclick={() => app.showAll()} title="Show the whole print">All</button>
    {/if}
  </div>
{/if}

<style>
  .timeline {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--shadow);
    user-select: none;
    -webkit-user-select: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 0;
    background: transparent;
    color: var(--text);
    flex: none;
  }
  .icon:hover {
    background: var(--hover);
  }
  .icon.play {
    background: var(--accent);
    color: #04201c;
  }
  .icon.small {
    width: 28px;
    height: 28px;
    color: var(--muted);
  }
  .speed,
  .all {
    border: 0;
    border-radius: 8px;
    background: var(--chip);
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    padding: 6px 8px;
    min-width: 46px;
    font-variant-numeric: tabular-nums;
    flex: none;
  }
  .all {
    color: var(--accent);
    min-width: 0;
  }
  .scrub {
    position: relative;
    flex: 1;
    min-width: 60px;
    height: 34px;
    cursor: pointer;
    touch-action: none;
  }
  .rail {
    position: absolute;
    left: 0;
    right: 0;
    top: 15px;
    height: 4px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
  }
  .knob {
    position: absolute;
    top: 9px;
    width: 16px;
    height: 16px;
    margin-left: -8px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
  }
  .readout {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text);
    padding: 0 4px;
  }
  .readout .of {
    color: var(--muted);
    margin-left: 3px;
  }
  .compact .readout .of {
    display: none;
  }
</style>
