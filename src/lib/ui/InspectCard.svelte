<script lang="ts">
  // Details for a tapped/clicked segment.
  import { app } from '../state.svelte';
  import { FEATURES } from '../gcode/features';
  import { formatDuration } from '../render/colors';
  import Icon from './Icon.svelte';

  const info = $derived.by(() => {
    const r = app.result;
    const sel = app.inspect;
    if (!r || !sel || sel.index >= r.ext.count) return null;
    const i = sel.index;
    const e = r.ext;
    const layer = e.layer[i];
    const f = r.filaments.find((x) => x.index === e.tool[i]);
    const o = i * 6;
    return {
      feature: FEATURES[e.feature[i]],
      layer,
      z: r.layers.z[layer],
      layerTime: r.layers.time[layer],
      filament: f,
      tool: e.tool[i],
      rows: [
        ['Speed', `${e.speed[i].toFixed(0)} mm/s`],
        ['Flow', `${e.flow[i].toFixed(1)} mm³/s`],
        ['Width', `${e.width[i].toFixed(2)} mm`],
        ['Height', `${e.height[i].toFixed(2)} mm`],
        ['Fan', `${e.fan[i]}%`],
        ['Temp', e.temp[i] ? `${e.temp[i].toFixed(0)} °C` : '—'],
        ['Accel', `${e.accel[i].toFixed(0)} mm/s²`],
        ['Position', `${e.pos[o + 3].toFixed(1)}, ${e.pos[o + 4].toFixed(1)}`],
      ],
    };
  });
</script>

{#if info}
  <div class="card" role="dialog" aria-label="Segment details">
    <div class="head">
      <span class="sw" style={`background:${info.feature.color}`}></span>
      <b>{info.feature.name}</b>
      <button class="x" onclick={() => (app.inspect = null)} aria-label="Close"><Icon name="x" size={16} /></button>
    </div>
    <div class="sub">
      Layer {info.layer + 1} · Z {info.z.toFixed(2)} mm · {formatDuration(info.layerTime)} layer
      {#if info.filament}
        <span class="fil"><span class="dot" style={`background:${info.filament.color}`}></span>T{info.tool + 1} {info.filament.type}</span>
      {/if}
    </div>
    <div class="grid">
      {#each info.rows as [k, v]}
        <span class="k">{k}</span><span class="v">{v}</span>
      {/each}
    </div>
    <button class="go" onclick={() => app.setLayers(app.layerLo, info.layer)}>Show up to this layer</button>
  </div>
{/if}

<style>
  .card {
    width: 260px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px 14px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: var(--shadow);
    font-size: 13px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .head b {
    flex: 1;
    font-size: 14px;
  }
  .sw,
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    display: inline-block;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: -1px;
  }
  .x {
    border: 0;
    background: none;
    color: var(--muted);
    padding: 2px;
    display: grid;
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
    margin: 4px 0 10px;
    line-height: 1.5;
  }
  .fil {
    white-space: nowrap;
    margin-left: 4px;
  }
  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
  }
  .k {
    color: var(--muted);
  }
  .v {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .go {
    margin-top: 10px;
    width: 100%;
    border: 1px solid var(--line);
    background: var(--chip);
    color: var(--accent);
    border-radius: 9px;
    padding: 7px;
    font-size: 12.5px;
    font-weight: 600;
  }
</style>
