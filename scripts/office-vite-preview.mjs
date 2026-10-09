import { createServer } from 'vite';
import path from 'node:path';
process.env.VITE_DEV_API_ORIGIN = 'http://127.0.0.1:47170';
const server = await createServer({ configFile: path.resolve('vite.renderer.config.mts'), server: { host: '127.0.0.1', port: 47171, strictPort: true, hmr: false, proxy: { '/_office': { target: 'http://127.0.0.1:47170', changeOrigin: true } } } });
await server.listen();
server.printUrls();
