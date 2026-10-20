// Runs the pinned upstream engine in a dedicated, isolated local process.
import { createServer } from 'vite';
const server = await createServer({
  configFile: 'config/vite.config.ts',
  server: { host: '127.0.0.1', port: 47831, strictPort: false, open: false },
});
await server.listen();
const address = server.httpServer.address();
process.stdout.write(`REIZO_EDITOR_READY ${JSON.stringify({ origin: `http://127.0.0.1:${address.port}` })}\n`);
async function stop() { await server.close(); process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
