<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state.svelte';
  import { formatDuration } from './lib/render/colors';
  import { filamentCost } from './lib/pricing';
  import { fetchSharedGcode, loadShareManifest } from './lib/share/share';
  import { PRINTERS } from './lib/render/printers';
  import Stage from './lib/ui/Stage.svelte';
  import Panel from './lib/ui/Panel.svelte';
  import LayerSlider from './lib/ui/LayerSlider.svelte';
  import Timeline from './lib/ui/Timeline.svelte';
  import ViewControls from './lib/ui/ViewControls.svelte';
  import InspectCard from './lib/ui/InspectCard.svelte';
  import Icon from './lib/ui/Icon.svelte';

  let stage: Stage;
  let fileInput: HTMLInputElement;
  let dragDepth = $state(0);
  let sheetOpen = $state(false);
  let isMobile = $state(false);
  let booting = $state(true);

  const r = $derived(app.result);
  const summary = $derived.by(() => {
    if (!r) return null;
    const g = r.filaments.reduce((a, f) => a + f.weightG, 0);
    const costs = r.filaments.map((f) => filamentCost(f, app.prices));
    const cost = costs.reduce<number>((a, c) => a + (c ?? 0), 0);
    return { time: formatDuration(r.totalTimeS, false), g: `${g.toFixed(1)} g`, cost: costs.some((c) => c !== null) ? `$${cost.toFixed(2)}` : null };
  });

  onMount(() => {
    const mq = matchMedia('(max-width: 899px)');
    const upd = () => (isMobile = mq.matches);
    upd();
    mq.addEventListener('change', upd);
    boot();
    return () => mq.removeEventListener('change', upd);
  });

  async function boot() {
    const manifest = await loadShareManifest();
    if (manifest) {
      app.shareManifest = manifest;
      document.title = `${manifest.name.replace(/\.gcode$/i, '')} · Print Preview`;
      app.loading = { label: 'Downloading shared print', fraction: 0 };
      try {
        const blob = await fetchSharedGcode((f) => (app.loading = { label: 'Downloading shared print', fraction: f }));
        await app.open(blob, manifest.name);
      } catch (e) {
        app.loading = null;
        app.error = e instanceof Error ? e.message : String(e);
      }
    }
    booting = false;
  }

  function openFiles(files: FileList | null | undefined) {
    const f = files?.[0];
    if (!f) return;
    app.shareManifest = null;
    sheetOpen = false;
    document.title = `${f.name.replace(/\.(gcode|3mf|gz|zip)$/gi, '')} · Print Preview`;
    app.open(f, f.name);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    if (app.shareManifest) return;
    openFiles(e.dataTransfer?.files);
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!r) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowUp':
        app.playing = false;
        app.setLayers(app.layerLo, Math.min(r.layers.count - 1, app.layerHi + step));
        break;
      case 'ArrowDown':
        app.playing = false;
        app.setLayers(Math.min(app.layerLo, Math.max(0, app.layerHi - step)), Math.max(0, app.layerHi - step));
        break;
      case 'ArrowRight': {
        app.playing = false;
        const [, b] = app.layerMoveBounds(app.layerHi);
        app.moveHi = Math.min(b, app.moveHi + step);
        break;
      }
      case 'ArrowLeft': {
        app.playing = false;
        const [a] = app.layerMoveBounds(app.layerHi);
        app.moveHi = Math.max(a, Math.min(app.moveHi, app.layerMoveBounds(app.layerHi)[1]) - step);
        break;
      }
      case ' ':
        (document.querySelector('.timeline .play') as HTMLButtonElement | null)?.click();
        break;
      case 'r':
      case 'R':
        stage.resetView();
        break;
      case 'Escape':
        app.inspect = null;
        break;
      case 'a':
      case 'A':
        app.showAll();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // sheet drag (mobile)
  let sheetDrag: { y: number; open: boolean } | null = null;
  function sheetDown(e: PointerEvent) {
    sheetDrag = { y: e.clientY, open: sheetOpen };
  }
  function sheetUp(e: PointerEvent) {
    if (!sheetDrag) return;
    const dy = e.clientY - sheetDrag.y;
    if (Math.abs(dy) < 8) sheetOpen = !sheetOpen;
    else sheetOpen = dy < 0;
    sheetDrag = null;
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="app"
  class:mobile={isMobile}
  role="application"
  ondragenter={(e) => {
    e.preventDefault();
    dragDepth++;
  }}
  ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  {#if !isMobile}
    <aside class="side">
      <header class="brand">
        <span class="logo">3P</span>
        <span>Print Preview</span>
      </header>
      <div class="side-scroll">
        {#if r}
          <Panel onOpenFile={() => fileInput.click()} />
        {:else}
          <div class="side-empty">
            <p>Open a sliced file to see layers, line types, speeds, print time, filament and cost.</p>
            <p class="small">Your files are processed right here in the browser.</p>
          </div>
        {/if}
      </div>
    </aside>
  {/if}

  <main class="stage">
    <Stage bind:this={stage} insets={!r ? { right: 0, bottom: 0 } : isMobile ? { right: 0, bottom: 200 } : { right: 70, bottom: 80 }} />

    {#if isMobile}
      <div class="top-mobile">
        <span class="logo">3P</span>
        {#if r}
          <span class="fname">{r.fileName.replace(/\.gcode$/i, '')}</span>
        {:else}
          <span class="fname">Print Preview</span>
        {/if}
      </div>
    {/if}

    <div class="view-controls">
      <ViewControls onReset={() => stage.resetView()} onView={(p) => stage.setView(p)} />
    </div>

    {#if r && !isMobile}
      <div class="layers-v">
        <LayerSlider vertical />
      </div>
      <div class="bottom-bar">
        <Timeline />
      </div>
    {/if}

    {#if app.inspect}
      <div class="inspect">
        <InspectCard />
      </div>
    {/if}

    {#if !r && !app.loading && !booting}
      <div class="empty">
        <div class="empty-card">
          <div class="empty-icon"><Icon name="layers" size={30} /></div>
          <h1>Drop a sliced G-code file</h1>
          <p>Creality Print · Bambu Studio · OrcaSlicer · PrusaSlicer<br /><span class="formats">.gcode · .gcode.3mf · .gcode.gz</span></p>
          <button class="primary" onclick={() => fileInput.click()}><Icon name="upload" size={18} />Choose file</button>
          <div class="printer-pick">
            {#each Object.values(PRINTERS) as p (p.id)}
              <button
                class:active={app.printerId === p.id}
                onclick={() => {
                  app.printerPref = p.id;
                  app.persist();
                }}>{p.name}</button
              >
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if dragDepth > 0 && !app.shareManifest}
      <div class="drop-overlay"><div><Icon name="upload" size={34} /><span>Drop to preview</span></div></div>
    {/if}

    {#if app.loading}
      <div class="loading">
        <div class="loading-card">
          <span>{app.loading.label}</span>
          <div class="bar"><div style={`width:${Math.round(app.loading.fraction * 100)}%`}></div></div>
        </div>
      </div>
    {/if}

    {#if app.error}
      <div class="toast" role="alert">
        <span>{app.error}</span>
        <button onclick={() => (app.error = null)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
      </div>
    {/if}

    {#if app.choosePlates && app.file}
      <div class="loading">
        <div class="loading-card plates">
          <span>This project has {app.choosePlates.length} plates. Which one?</span>
          <div class="plate-list">
            {#each app.choosePlates as p (p.name)}
              <button onclick={() => app.open(app.file!, app.pendingName, p.name)}>{p.name.split('/').pop()?.replace(/\.gcode$/i, '').replace('plate_', 'Plate ')}</button>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if isMobile && r}
      <div class="mobile-dock" class:hidden={sheetOpen}>
        <LayerSlider vertical={false} />
        <Timeline compact />
      </div>
    {/if}
  </main>

  {#if isMobile && r}
    <div class="sheet" class:open={sheetOpen}>
      <div class="sheet-head" role="button" tabindex="0" onpointerdown={sheetDown} onpointerup={sheetUp} onkeydown={(e) => e.key === 'Enter' && (sheetOpen = !sheetOpen)} aria-expanded={sheetOpen}>
        <span class="grabber"></span>
        {#if summary}
          <div class="sum">
            <span><b>{summary.time}</b></span>
            <span>{summary.g}</span>
            {#if summary.cost}<span>{summary.cost}</span>{/if}
            <span class="chev"><Icon name={sheetOpen ? 'chevronDown' : 'chevronUp'} size={18} /></span>
          </div>
        {/if}
      </div>
      <div class="sheet-body">
        <Panel onOpenFile={() => fileInput.click()} />
      </div>
    </div>
  {/if}

  <input bind:this={fileInput} type="file" accept=".gcode,.gco,.g,.gz,.3mf,.zip,.bgcode,text/plain" hidden onchange={(e) => openFiles((e.target as HTMLInputElement).files)} />
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 340px 1fr;
    height: 100%;
    height: 100dvh;
  }
  .app.mobile {
    grid-template-columns: 1fr;
  }
  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel-solid);
    border-right: 1px solid var(--line);
    z-index: 2;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.01em;
    border-bottom: 1px solid var(--line);
  }
  .logo {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: #0d9488;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    flex: none;
  }
  .side-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .side-empty {
    padding: 20px 16px;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.5;
  }
  .side-empty .small {
    font-size: 12.5px;
  }
  .stage {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: radial-gradient(120% 90% at 50% 35%, #26303b 0%, #161b22 55%, #0d1014 100%);
  }
  .view-controls {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 3;
  }
  .layers-v {
    position: absolute;
    right: 10px;
    top: 104px;
    bottom: 90px;
    z-index: 2;
  }
  .bottom-bar {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(720px, calc(100% - 120px));
    z-index: 2;
  }
  .inspect {
    position: absolute;
    left: 14px;
    top: 14px;
    z-index: 4;
  }
  .mobile .inspect {
    top: 60px;
    left: 10px;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    z-index: 2;
    pointer-events: none;
  }
  .empty-card {
    pointer-events: auto;
    text-align: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 28px 26px 22px;
    max-width: 420px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: var(--shadow);
  }
  .empty-icon {
    display: inline-grid;
    place-items: center;
    width: 60px;
    height: 60px;
    border-radius: 16px;
    background: var(--accent-soft);
    color: var(--accent);
    margin-bottom: 12px;
  }
  .empty h1 {
    font-size: 20px;
    margin: 0 0 6px;
    letter-spacing: -0.01em;
  }
  .empty p {
    margin: 0 0 18px;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.6;
  }
  .formats {
    font-size: 12.5px;
    opacity: 0.85;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--accent);
    color: #04201c;
    border: 0;
    border-radius: 12px;
    padding: 12px 22px;
    font-weight: 700;
    font-size: 15px;
  }
  .printer-pick {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: 18px;
    flex-wrap: wrap;
  }
  .printer-pick button {
    border: 1px solid var(--line);
    background: var(--chip);
    color: var(--muted);
    border-radius: 99px;
    padding: 6px 12px;
    font-size: 12.5px;
  }
  .printer-pick button.active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .drop-overlay {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--accent);
    border-radius: 18px;
    background: rgba(13, 148, 136, 0.12);
    display: grid;
    place-items: center;
    z-index: 10;
    pointer-events: none;
  }
  .drop-overlay div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--accent);
    font-weight: 700;
    font-size: 18px;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    z-index: 8;
    background: rgba(8, 10, 13, 0.35);
  }
  .loading-card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 18px 20px;
    width: min(340px, calc(100% - 40px));
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 14px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  .loading-card span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .loading-card.plates span {
    white-space: normal;
  }
  .bar {
    height: 6px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }
  .plate-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .plate-list button {
    border: 1px solid var(--line);
    background: var(--chip);
    color: var(--text);
    border-radius: 9px;
    padding: 8px 12px;
  }
  .toast {
    position: absolute;
    left: 50%;
    top: 16px;
    transform: translateX(-50%);
    z-index: 12;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, calc(100% - 24px));
    background: #3a1d22;
    border: 1px solid #6b2f38;
    color: #ffd7dc;
    padding: 10px 12px 10px 14px;
    border-radius: 12px;
    font-size: 13.5px;
    box-shadow: var(--shadow);
  }
  .toast button {
    border: 0;
    background: none;
    color: inherit;
    display: grid;
    padding: 2px;
  }
  .mobile .toast {
    top: 60px;
  }

  /* ---------- phone */
  .top-mobile {
    position: absolute;
    top: calc(10px + env(safe-area-inset-top, 0px));
    left: 10px;
    right: 150px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 3;
    pointer-events: none;
  }
  .top-mobile .fname {
    font-weight: 650;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
  }
  .mobile .view-controls {
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: 10px;
  }
  .mobile-dock {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: calc(64px + var(--safe-bottom));
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 3;
    transition: opacity 0.2s;
  }
  .mobile-dock.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    background: var(--panel-solid);
    border-top: 1px solid var(--line);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    height: 80dvh;
    transform: translateY(calc(80dvh - 56px - var(--safe-bottom)));
    transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .sheet.open {
    transform: translateY(0);
  }
  .sheet-head {
    flex: none;
    height: 56px;
    padding: 6px 16px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .grabber {
    width: 38px;
    height: 5px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.22);
    margin-bottom: 8px;
  }
  .sum {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    font-size: 14px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .sum b {
    color: var(--text);
    font-size: 16px;
  }
  .chev {
    margin-left: auto;
    display: grid;
  }
  .sheet-body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: var(--safe-bottom);
  }
</style>
