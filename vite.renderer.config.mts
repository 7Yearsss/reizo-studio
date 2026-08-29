import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// eslint-disable-next-line import/no-unresolved -- package `exports` map, same as @tailwindcss/vite
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss(), wgslVitePlugin()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // Windows: default bind is ::1; Electron then loads http://localhost via
  // IPv4 (127.0.0.1) and gets ERR_CONNECTION_REFUSED. Pin IPv4.
  // Port 46173, not the Vite default 5173 — on this machine the low 5xxx
  // range is both Hyper-V-reserved (netsh excludedportrange 5155-5254) and
  // churned by another app's outbound ephemeral connections, both of which
  // make a strictPort bind fail with EACCES. 46173 sits clear of all that
  // and next to the API port block (47100+).
  server: {
    host: '127.0.0.1',
    port: 46173,
    strictPort: true,
  },
});
