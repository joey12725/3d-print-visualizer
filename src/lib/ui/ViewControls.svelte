<script lang="ts">
  import type { ViewPreset } from '../render/viewer';
  import Icon from './Icon.svelte';

  let { onReset, onView }: { onReset: () => void; onView: (p: ViewPreset) => void } = $props();
  const presets: { id: ViewPreset; label: string }[] = [
    { id: 'iso', label: '3D' },
    { id: 'top', label: 'Top' },
    { id: 'front', label: 'Front' },
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
  ];
  let open = $state(false);
</script>

<div class="controls">
  <button class="reset" onclick={onReset} title="Reset view (R)">
    <Icon name="reset" size={17} /><span>Reset view</span>
  </button>
  <div class="presets" class:open>
    <button class="toggle" onclick={() => (open = !open)} aria-expanded={open} aria-label="Camera angles" title="Camera angles">
      <Icon name="cube" size={17} />
    </button>
    {#each presets as p (p.id)}
      <button
        class="preset"
        onclick={() => {
          onView(p.id);
          open = false;
        }}>{p.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  button {
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--text);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--shadow);
  }
  .reset {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border-radius: 12px;
    padding: 9px 13px;
    font-weight: 600;
    font-size: 13.5px;
  }
  .presets {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
  }
  .toggle {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
  }
  .preset {
    display: none;
    border-radius: 10px;
    padding: 7px 12px;
    font-size: 13px;
    min-width: 64px;
  }
  .open .preset {
    display: block;
  }
  .open .toggle {
    border-color: var(--accent);
    color: var(--accent);
  }
  @media (min-width: 900px) {
    .toggle {
      display: none;
    }
    .preset {
      display: block;
      padding: 6px 10px;
      min-width: 58px;
      font-size: 12.5px;
    }
    .presets {
      flex-direction: row;
    }
  }
</style>
