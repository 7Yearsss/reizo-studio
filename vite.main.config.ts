import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Keep ws optional native helpers as runtime requires so its try/catch
      // can fall back to JavaScript when they are not installed.
      external: ['node:sqlite', 'bufferutil', 'utf-8-validate'],
    },
  },
});
