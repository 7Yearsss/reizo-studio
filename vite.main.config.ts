import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Built-in module — never bundle it.
      external: ['node:sqlite'],
    },
  },
});
