import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The whole viewer builds into a single self-contained index.html. That file is
// re-uploaded alongside each shared G-code, so every share link is standalone.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['test/**/*.test.ts'] },
});
