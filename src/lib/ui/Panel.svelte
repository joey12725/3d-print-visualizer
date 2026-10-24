<script lang="ts">
  // Side panel (desktop) / bottom sheet (phone). The top answers "am I happy with this
  // print?" at a glance; everything else lives under Details.
  import { app } from '../state.svelte';
  import { COLOR_MODES, formatDuration } from '../render/colors';
  import { FEATURES } from '../gcode/features';
  import { detectPrinter, PRINTERS, type PrinterId } from '../render/printers';
  import { filamentCost, materialKey, DEFAULT_PRICES } from '../pricing';
  import Icon from './Icon.svelte';
  import SharePanel from './SharePanel.svelte';
  import { canShare, savedShares } from '../share/share';

  let { onOpenFile }: { onOpenFile: () => void } = $props();

  const r = $derived(app.result);
  const totals = $derived.by(() => {
    if (!r) return null;
    let g = 0;
    let mm = 0;
    let cost = 0;
    let costKnown = true;
    for (const f of r.filaments) {
      g += f.weightG;
      mm += f.lengthMm;
      const c = filamentCost(f, app.prices);
      if (c === null) costKnown = false;
      else cost += c;
    }
    return { g, mm, cost, costKnown };
  });
  const materials = $derived([...new Set([...Object.keys(DEFAULT_PRICES), ...(r?.filaments.map((f) => materialKey(f.type)) ?? [])])]);
  const detected = $derived(r ? detectPrinter(r.meta) : null);
  const height = $derived(r ? (r.layers.z[r.layers.count - 1] ?? r.bounds.max[2]) : 0);
  const hiddenCount = $derived(Object.values(app.hidden).filter(Boolean).length);
  let pricesOpen = $state(false);

  function toggleFeature(id: number) {
    app.hidden = { ...app.hidden, [id]: !app.hidden[id] };
  }
  function soloFeature(id: number) {
    const next: Record<number, boolean> = {};
    for (const f of FEATURES) next[f.id] = f.id !== id;
    const alreadySolo = FEATURES.every((f) => !!app.hidden[f.id] === (f.id !== id));
    app.hidden = alreadySolo ? {} : next;
  }
  function setPrinter(v: string) {
    app.printerPref = v as PrinterId | 'auto';
    app.persist();
  }
  function setOption(k: keyof typeof app.options, v: boolean) {
    app.options = { ...app.options, [k]: v };
    app.persist();
  }
  function toggleDetails() {
    app.detailsOpen = !app.detailsOpen;
    app.persist();
  }
  const money = (v: number) => `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}`;
</script>

{#if r}
  <section class="file">
    {#if r.meta.thumbnail || app.shareManifest?.thumbnail}
      <img class="thumb" src={r.meta.thumbnail || app.shareManifest?.thumbnail} alt="" />
    {:else}
      <div class="thumb placeholder"><Icon name="cube" size={24} /></div>
    {/if}
    <div class="name" title={r.fileName}>{r.fileName.replace(/\.gcode$/i, '')}</div>
    {#if !app.shareManifest}
      <button class="ghost-btn" onclick={onOpenFile} title="Open another file" aria-label="Open another file"><Icon name="upload" size={16} /></button>
    {/if}
  </section>

  {#if app.plates && app.plates.length > 1 && app.file}
    <div class="plates">
      {#each app.plates as p (p.name)}
        <button class:active={p.name === app.fileEntry} onclick={() => app.open(app.file!, app.pendingName, p.name)}>
          {p.name.split('/').pop()?.replace(/\.gcode$/i, '').replace('plate_', 'Plate ')}
        </button>
      {/each}
    </div>
  {/if}

  <section class="glance">
    <div class="stats">
      <div class="tile">
        <span class="k">Print time</span>
        <span class="v">{formatDuration(r.totalTimeS, false)}</span>
      </div>
      <div class="tile">
        <span class="k">Filament</span>
        <span class="v">{totals!.g.toFixed(1)}<small> g</small></span>
      </div>
    </div>

    <table class="fil">
      <tbody>
        {#each r.filaments as f (f.index)}
          {@const c = filamentCost(f, app.prices)}
          <tr>
            <td><span class="sw" style={`background:${f.color}`}></span></td>
            <td class="t"><b>{f.type}</b><span class="slot">T{f.index + 1}</span></td>
            <td class="n grams">{f.weightG.toFixed(1)} g</td>
            <td class="n">{(f.lengthMm / 1000).toFixed(2)} m</td>
            <td class="n">{c === null ? '—' : money(c)}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="facts">
      <span><b>{r.layers.count}</b> layers</span>
      <span><b>{height.toFixed(1)}</b> mm tall</span>
      {#if totals!.cost > 0}<span><b>{money(totals!.cost)}</b> filament{totals!.costKnown ? '' : ' (some prices unset)'}</span>{/if}
    </div>
  </section>

  {#if app.shareManifest || canShare(false) || savedShares().length}
    <section class="share">
      <SharePanel />
    </section>
  {/if}

  <button class="details-toggle" onclick={toggleDetails} aria-expanded={app.detailsOpen}>
    <span>Details</span>
    <span class="hint">color modes, line types, display, slicer</span>
    <Icon name={app.detailsOpen ? 'chevronUp' : 'chevronDown'} size={16} />
  </button>

  {#if app.detailsOpen}
    <section>
      <h3>Color by</h3>
      <div class="modes" role="radiogroup" aria-label="Color by">
        {#each COLOR_MODES as m (m.id)}
          <button
            role="radio"
            aria-checked={app.colorMode === m.id}
            class:active={app.colorMode === m.id}
            onclick={() => {
              app.colorMode = m.id;
              app.persist();
            }}>{m.label}</button
          >
        {/each}
      </div>

      {#if app.legend}
        <div class="legend" class:range={app.legend.kind === 'range'}>
          {#if app.legend.kind === 'categorical'}
            {#each app.legend.items as it (it.label)}
              {@const toggleable = app.colorMode === 'feature' && it.key !== undefined}
              <div class="row" class:off={toggleable && app.hidden[it.key!]}>
                {#if toggleable}
                  <button class="eye" onclick={() => toggleFeature(it.key!)} aria-label={`${app.hidden[it.key!] ? 'Show' : 'Hide'} ${it.label}`}>
                    <Icon name={app.hidden[it.key!] ? 'eyeOff' : 'eye'} size={15} />
                  </button>
                {/if}
                <span class="sw" style={`background:${it.color}`}></span>
                {#if toggleable}
                  <button class="lbl" ondblclick={() => soloFeature(it.key!)} onclick={() => toggleFeature(it.key!)} title="Click to hide · double-click to show only this">{it.label}</button>
                {:else}
                  <span class="lbl">{it.label}</span>
                {/if}
                <span class="detail">{it.detail ?? ''}</span>
              </div>
            {/each}
            {#if app.colorMode === 'feature'}
              {@const travel = r.featureStats.find((s) => s.feature === -1)}
              {#if travel}
                <div class="row travel">
                  <span class="eye-spacer"></span>
                  <span class="sw line"></span>
                  <span class="lbl">Travel</span>
                  <span class="detail">{formatDuration(travel.timeS, false)}</span>
                </div>
              {/if}
              {#if hiddenCount}
                <button class="link" onclick={() => (app.hidden = {})}>Show all line types</button>
              {/if}
            {/if}
          {:else}
            <div class="ramp">
              <div class="bar" style={`background:linear-gradient(to bottom, ${app.legend.items.map((i) => i.color).join(',')})`}></div>
              <div class="ticks">
                {#each app.legend.items as it, i (i)}
                  <span>{it.label}</span>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <section>
      <h3>Display</h3>
      <div class="seg" role="radiogroup" aria-label="Render style">
        <button class:active={app.options.tubes} onclick={() => setOption('tubes', true)}>3D lines</button>
        <button class:active={!app.options.tubes} onclick={() => setOption('tubes', false)}>Fast lines</button>
      </div>
      <label class="toggle"><input type="checkbox" checked={app.options.travels} onchange={(e) => setOption('travels', (e.target as HTMLInputElement).checked)} /><span>Travel moves</span></label>
      <label class="toggle"><input type="checkbox" checked={app.options.retractions} onchange={(e) => setOption('retractions', (e.target as HTMLInputElement).checked)} /><span>Retractions</span></label>
      <label class="toggle"><input type="checkbox" checked={app.options.ghost} onchange={(e) => setOption('ghost', (e.target as HTMLInputElement).checked)} /><span>Show layers below range in grey</span></label>
      <label class="toggle"><input type="checkbox" checked={app.options.volume} onchange={(e) => setOption('volume', (e.target as HTMLInputElement).checked)} /><span>Build volume outline</span></label>
      <label class="select">
        <span>Printer</span>
        <select value={app.printerPref} onchange={(e) => setPrinter((e.target as HTMLSelectElement).value)}>
          <option value="auto">Auto{detected ? ` (${detected === 'generic' ? 'from file' : PRINTERS[detected].name})` : ''}</option>
          <option value="k2plus">Creality K2 Plus</option>
          <option value="a1">Bambu Lab A1</option>
          <option value="generic">From G-code bed size</option>
        </select>
      </label>
    </section>

    <section>
      <h3>File</h3>
      <dl class="meta">
        {#if r.meta.slicer}<dt>Slicer</dt><dd>{r.meta.slicer}</dd>{/if}
        {#if r.meta.printerSettingsId || r.meta.printerModel}<dt>Printer profile</dt><dd>{r.meta.printerSettingsId || r.meta.printerModel}</dd>{/if}
        <dt>Nozzle</dt><dd>{r.meta.nozzleDiameter} mm</dd>
        {#if r.meta.bedType}<dt>Plate</dt><dd>{r.meta.bedType}</dd>{/if}
        {#each r.filaments as f (f.index)}
          {#if f.name}<dt>T{f.index + 1}</dt><dd>{f.name}</dd>{/if}
        {/each}
      </dl>
      <button class="link" onclick={() => (pricesOpen = !pricesOpen)}>
        {pricesOpen ? 'Hide' : 'Edit'} filament prices
      </button>
      {#if pricesOpen}
        <div class="prices">
          {#each materials as m (m)}
            <label>
              <span>{m}</span>
              <span class="money"
                >$<input
                  type="number"
                  min="0"
                  step="0.5"
                  inputmode="decimal"
                  value={app.prices[m] ?? ''}
                  placeholder="—"
                  onchange={(e) => {
                    const v = parseFloat((e.target as HTMLInputElement).value);
                    const next = { ...app.prices };
                    if (Number.isFinite(v)) next[m] = v;
                    else delete next[m];
                    app.setPrices(next);
                  }}
                /> /kg</span
              >
            </label>
          {/each}
        </div>
      {/if}
    </section>

    {#if r.warnings.length}
      <section class="warn">
        {#each r.warnings as w}<p><Icon name="info" size={14} /> {w}</p>{/each}
      </section>
    {/if}
  {/if}
{/if}

<style>
  section {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  h3 {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .hint {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    opacity: 0.7;
    margin-left: 4px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .thumb {
    width: 52px;
    height: 52px;
    border-radius: 10px;
    object-fit: cover;
    background: #0b0d10;
    flex: none;
    border: 1px solid var(--line);
  }
  .placeholder {
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    font-size: 15px;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ghost-btn {
    border: 1px solid var(--line);
    background: var(--chip);
    color: var(--text);
    border-radius: 10px;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .plates {
    display: flex;
    gap: 6px;
    padding: 10px 16px 0;
    flex-wrap: wrap;
  }
  .plates button,
  .modes button,
  .seg button {
    border: 1px solid var(--line);
    background: var(--chip);
    color: var(--text);
    border-radius: 9px;
    padding: 7px 10px;
    font-size: 13px;
  }
  .plates button.active,
  .modes button.active,
  .seg button.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }
  .glance {
    padding-top: 4px;
  }
  .slot {
    color: var(--muted);
    font-size: 11.5px;
    margin-left: 6px;
  }
  .grams {
    color: var(--text) !important;
    font-weight: 650;
  }
  .details-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line);
    color: var(--text);
    padding: 14px 16px;
    font-size: 14px;
    font-weight: 650;
    text-align: left;
  }
  .details-toggle .hint {
    flex: 1;
    color: var(--muted);
    font-weight: 450;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .details-toggle :global(svg) {
    color: var(--muted);
    flex: none;
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0 0 4px;
    font-size: 12.5px;
  }
  .meta dt {
    color: var(--muted);
  }
  .meta dd {
    margin: 0;
    word-break: break-word;
  }
  .tile {
    background: var(--chip);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tile .k {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .tile .v {
    font-size: 24px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .tile .v small {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .facts b {
    color: var(--text);
    font-weight: 600;
  }
  .fil {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .fil td {
    padding: 5px 0;
    vertical-align: middle;
  }
  .fil td + td {
    padding-left: 8px;
  }
  .fil .t {
    width: 100%;
  }
  .fil .t b {
    font-weight: 600;
  }
  .n {
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .sw {
    display: inline-block;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    flex: none;
  }
  .link {
    background: none;
    border: 0;
    padding: 6px 0 0;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }
  .prices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
    margin-top: 8px;
  }
  .prices label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    gap: 6px;
  }
  .money {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--muted);
    font-size: 12px;
  }
  .prices input {
    width: 54px;
    background: var(--chip);
    border: 1px solid var(--line);
    color: var(--text);
    border-radius: 7px;
    padding: 5px 6px;
    font-size: 13px;
    text-align: right;
  }
  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .modes button {
    padding: 8px 4px;
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .legend {
    margin-top: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
  }
  .row.off .sw,
  .row.off .lbl,
  .row.off .detail {
    opacity: 0.35;
  }
  .row .lbl {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    color: var(--text);
    padding: 0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row .detail {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .eye {
    background: none;
    border: 0;
    color: var(--muted);
    padding: 2px;
    display: grid;
    place-items: center;
  }
  .eye-spacer {
    width: 19px;
  }
  .sw.line {
    background: #5b8def;
    height: 4px;
    border: 0;
    border-radius: 2px;
  }
  .ramp {
    display: flex;
    gap: 10px;
    height: 220px;
  }
  .bar {
    width: 14px;
    border-radius: 7px;
    border: 1px solid rgba(255, 255, 255, 0.18);
  }
  .ticks {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    margin: -6px 0;
  }
  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 8px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    padding: 6px 0;
    cursor: pointer;
  }
  .toggle input {
    appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.16);
    position: relative;
    flex: none;
    margin: 0;
    transition: background 0.15s;
    cursor: pointer;
  }
  .toggle input::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .toggle input:checked {
    background: var(--accent);
  }
  .toggle input:checked::after {
    transform: translateX(14px);
  }
  .select {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 13.5px;
    padding-top: 8px;
  }
  .select select {
    background: var(--chip);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 7px 8px;
    font-size: 13px;
    max-width: 210px;
  }
  .warn p {
    margin: 0;
    font-size: 12px;
    color: #f5c86b;
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
</style>
