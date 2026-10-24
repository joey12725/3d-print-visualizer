<script lang="ts">
  // Slicer-style camera pad: home in the middle, arrows for top / front / left / right.
  import type { ViewPreset } from '../render/viewer';
  import Icon from './Icon.svelte';

  let { onReset, onView }: { onReset: () => void; onView: (p: ViewPreset) => void } = $props();
</script>

<div class="pad" role="group" aria-label="Camera">
  <button class="up" onclick={() => onView('top')} title="Top view" aria-label="Top view"><Icon name="arrowUp" size={15} /></button>
  <button class="left" onclick={() => onView('left')} title="Left view" aria-label="Left view"><Icon name="arrowLeft" size={15} /></button>
  <button class="home" onclick={onReset} title="Reset view (R)" aria-label="Reset view"><Icon name="home" size={17} /></button>
  <button class="right" onclick={() => onView('right')} title="Right view" aria-label="Right view"><Icon name="arrowRight" size={15} /></button>
  <button class="down" onclick={() => onView('front')} title="Front view" aria-label="Front view"><Icon name="arrowDown" size={15} /></button>
</div>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 30px);
    grid-template-rows: repeat(3, 30px);
    gap: 2px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--shadow);
  }
  button {
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    padding: 0;
  }
  button:hover {
    background: var(--hover);
    color: var(--text);
  }
  .up {
    grid-area: 1 / 2;
  }
  .left {
    grid-area: 2 / 1;
  }
  .home {
    grid-area: 2 / 2;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .right {
    grid-area: 2 / 3;
  }
  .down {
    grid-area: 3 / 2;
  }
</style>
