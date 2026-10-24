<script lang="ts">
  // Small inline icon set (stroke icons, 24×24 grid).
  const PATHS: Record<string, string[]> = {
    play: ['M7 4.5v15l12-7.5z'],
    pause: ['M8 5v14', 'M16 5v14'],
    reset: ['M3 12a9 9 0 1 0 2.64-6.36L3 8.3', 'M3 3.5v4.8h4.8'],
    upload: ['M12 15V4', 'M7.5 8.5 12 4l4.5 4.5', 'M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3'],
    link: ['M10 13.5a4.5 4.5 0 0 0 6.36 0l3-3a4.5 4.5 0 0 0-6.36-6.36l-1.3 1.3', 'M14 10.5a4.5 4.5 0 0 0-6.36 0l-3 3a4.5 4.5 0 0 0 6.36 6.36l1.3-1.3'],
    eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    eyeOff: ['M3 3l18 18', 'M10.6 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1', 'M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
    cube: ['M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z', 'M12 21.2V12', 'M20.5 7.5 12 12 3.5 7.5'],
    copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
    check: ['M4.5 12.5l5 5 10-11'],
    x: ['M6 6l12 12', 'M18 6 6 18'],
    chevronUp: ['M6 15l6-6 6 6'],
    chevronDown: ['M6 9l6 6 6-6'],
    layers: ['M12 3 2.5 8 12 13l9.5-5z', 'M2.5 12.5 12 17.5l9.5-5', 'M2.5 16.5 12 21.5l9.5-5'],
    file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 20h14'],
    skipBack: ['M6 5v14', 'M18 5 8 12l10 7z'],
    skipForward: ['M18 5v14', 'M6 5l10 7-10 7z'],
    maximize: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
    info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 7.5v.5'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  };

  let { name, size = 18, stroke = 2 }: { name: keyof typeof PATHS | string; size?: number; stroke?: number } = $props();
  const fill = $derived(name === 'play' ? 'currentColor' : 'none');
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each PATHS[name] ?? [] as d}
    <path {d} />
  {/each}
</svg>
