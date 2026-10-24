<script lang="ts">
  // Always-visible "which printer is this" chip. Tapping it opens the printer picker.
  import { app } from '../state.svelte';
  import { detectPrinter, PRINTERS, resolvePrinter, type PrinterId } from '../render/printers';

  const id = $derived(app.printerId);
  const name = $derived(id === 'generic' ? resolvePrinter('generic', app.result?.meta ?? null).name : PRINTERS[id].name);
  const detected = $derived(app.result ? detectPrinter(app.result.meta) : null);
</script>

<label class="badge" data-printer={id} title="Printer (tap to change)">
  <span class="dot"></span>
  <span class="label">{name}</span>
  <select
    value={app.printerPref}
    aria-label="Printer"
    onchange={(e) => {
      app.printerPref = (e.target as HTMLSelectElement).value as PrinterId | 'auto';
      app.persist();
    }}
  >
    <option value="auto">Auto{detected ? ` (${detected === 'generic' ? 'from file' : PRINTERS[detected].name})` : ''}</option>
    <option value="k2plus">Creality K2 Plus</option>
    <option value="a1">Bambu Lab A1</option>
    <option value="generic">From G-code bed size</option>
  </select>
</label>

<style>
  .badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px 7px 10px;
    border-radius: 99px;
    background: var(--panel);
    border: 1px solid var(--line);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--shadow);
    font-size: 13px;
    font-weight: 650;
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    background: #5b6470;
    flex: none;
  }
  [data-printer='k2plus'] .dot {
    background: #0d0d0f;
  }
  [data-printer='a1'] .dot {
    background: linear-gradient(135deg, #c9a45c, #8a6a33);
    border-color: #e4e6e9;
  }
  select {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    font-size: 16px; /* avoids iOS zoom */
  }
</style>
