<script lang="ts">
  import { app } from '../state.svelte';
  import { canShare, createShare, downloadSharedGcode, forgetShare, savedShares, SHARE_TTL_DAYS } from '../share/share';
  import Icon from './Icon.svelte';

  let shares = $state(savedShares());
  let copied = $state<string | null>(null);
  const enabled = $derived(canShare(!!app.shareManifest));

  async function start() {
    if (!app.file || !app.result) return;
    app.share = { status: 'working', label: 'Compressing G-code…', fraction: 0 };
    try {
      const res = await createShare({
        file: app.file,
        entry: app.fileEntry,
        name: app.result.fileName,
        printer: app.printerId,
        thumbnail: app.result.meta.thumbnail,
        onProgress: (p) => {
          const label = p.phase === 'compress' ? 'Compressing G-code…' : p.phase === 'upload' ? `Uploading… ${Math.round(p.fraction * 100)}%` : 'Publishing…';
          app.share = { status: 'working', label, fraction: p.fraction };
        },
      });
      app.share = { status: 'done', result: res };
      shares = savedShares();
      copy(res.url);
    } catch (e) {
      app.share = { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function copy(url: string) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ url, title: 'Print preview' });
        return;
      }
      await navigator.clipboard.writeText(url);
      copied = url;
      setTimeout(() => (copied = null), 1800);
    } catch {
      /* user dismissed the share sheet */
    }
  }

  let downloading = $state(false);
  async function download(name: string) {
    downloading = true;
    try {
      await downloadSharedGcode(name, app.file);
    } catch (e) {
      app.error = `Couldn't prepare the G-code: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      downloading = false;
    }
  }

  function remove(url: string) {
    forgetShare(url);
    shares = savedShares();
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
</script>

{#if app.shareManifest || enabled || shares.length}
  <h3>Share</h3>
{/if}

{#if app.shareManifest}
  {@const m = app.shareManifest}
  <div class="note">
    <Icon name="info" size={16} />
    <div>
      Shared link · deleted automatically on <b>{fmtDate(m.expiresAt)}</b>
      ({daysLeft(m.expiresAt)} day{daysLeft(m.expiresAt) === 1 ? '' : 's'} left)
    </div>
  </div>
  <div class="actions">
    <button class="btn" onclick={() => copy(location.href.split('#')[0])}>
      <Icon name={copied ? 'check' : 'link'} size={16} />{copied ? 'Copied' : 'Copy link'}
    </button>
    <button class="btn secondary" onclick={() => download(m.name)} disabled={downloading}>
      <Icon name="download" size={16} />{downloading ? 'Preparing…' : 'Download G-code'}
    </button>
  </div>
{:else if enabled}
  {#if app.share.status === 'working'}
    <div class="progress"><div style={`width:${Math.round((app.share.fraction ?? 0) * 100)}%`}></div></div>
    <p class="status">{app.share.label}</p>
  {:else if app.share.status === 'done' && app.share.result}
    {@const s = app.share.result}
    <div class="result">
      <a href={s.url} target="_blank" rel="noopener">{s.url.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>
      <div class="actions">
        <button class="btn" onclick={() => copy(s.url)}><Icon name={copied === s.url ? 'check' : 'copy'} size={16} />{copied === s.url ? 'Copied' : 'Copy'}</button>
        <a class="btn secondary" href={s.url} target="_blank" rel="noopener"><Icon name="external" size={16} />Open</a>
      </div>
      <p class="status">Expires {fmtDate(s.expiresAt)}</p>
    </div>
  {:else}
    <button class="btn wide" onclick={start} disabled={!app.file}>
      <Icon name="link" size={16} />Create {SHARE_TTL_DAYS}-day link
    </button>
    {#if app.share.status === 'error'}
      <p class="error">{app.share.error}</p>
    {/if}
  {/if}
{/if}

{#if !app.shareManifest && shares.length}
  <div class="recent">
    <h4>Your links</h4>
    {#each shares as s (s.url)}
      <div class="share-row">
        <a href={s.url} target="_blank" rel="noopener" class="share-name" title={s.name}>{s.name.replace(/\.gcode$/i, '')}</a>
        <span class="left">{daysLeft(s.expiresAt)}d</span>
        <button class="mini" onclick={() => copy(s.url)} aria-label="Copy link"><Icon name={copied === s.url ? 'check' : 'copy'} size={14} /></button>
        <button class="mini" onclick={() => remove(s.url)} aria-label="Remove from this list" title="Remove from this list"><Icon name="x" size={14} /></button>
      </div>
    {/each}
  </div>
{/if}

<style>
  h3 {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h4 {
    margin: 14px 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .note {
    display: flex;
    gap: 8px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text);
    background: var(--accent-soft);
    border: 1px solid rgba(45, 212, 191, 0.3);
    padding: 10px 12px;
    border-radius: 12px;
    margin-bottom: 10px;
  }
  .note :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    background: var(--accent);
    color: #04201c;
    border: 0;
    border-radius: 10px;
    padding: 10px 14px;
    font-weight: 650;
    font-size: 14px;
    text-decoration: none;
  }
  .btn.secondary {
    background: var(--chip);
    color: var(--text);
    border: 1px solid var(--line);
  }
  .btn.wide {
    width: 100%;
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .progress {
    height: 6px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .progress div {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .status {
    font-size: 12px;
    color: var(--muted);
    margin: 6px 0 0;
  }
  .error {
    font-size: 12.5px;
    color: #ff8a8a;
    margin: 8px 0 0;
    word-break: break-word;
  }
  .result a:not(.btn) {
    display: block;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
    word-break: break-all;
  }
  .share-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    font-size: 13px;
  }
  .share-name {
    flex: 1;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .share-name:hover {
    color: var(--accent);
  }
  .left {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .mini {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 0;
    background: var(--chip);
    color: var(--muted);
  }
</style>
