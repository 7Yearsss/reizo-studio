// Compiled by build-openchatcut-runtime.mjs against the pinned upstream sources.
// The host sets a private writable cwd before importing any server modules.
import { startEmbeddedServer } from './desktop/embedded-server.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const { server, origin } = await startEmbeddedServer(path.join(root, 'ui'));
process.stdout.write(`REIZO_EDITOR_READY ${JSON.stringify({ origin })}\n`);
function stop() { server.closeAllConnections(); server.close(() => process.exit(0)); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

// Parent death must not leave a hidden render engine behind on Windows.
const parent = Number(process.env.REIZO_EDITOR_PARENT_PID);
if (Number.isInteger(parent) && parent > 0) {
  setInterval(() => { try { process.kill(parent, 0); } catch { stop(); } }, 2000).unref();
}
