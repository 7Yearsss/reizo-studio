import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Windows: default bind is ::1; Electron then loads http://localhost:5173
  // via IPv4 (127.0.0.1) and gets ERR_CONNECTION_REFUSED. Pin IPv4.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
