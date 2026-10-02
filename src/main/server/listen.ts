import { serve, type ServerType } from '@hono/node-server';
import { API_BASE_PORT, API_PORT_SCAN_ATTEMPTS } from '../../shared/constants';
import { createApp } from './app';
import type { SessionStore } from '../../shared/chat';
import type { SettingsStore } from './storage/settingsStore';
import type { ScheduleStore } from './storage/scheduleStore';
import type { ThoughtStore } from './storage/thoughtStore';
import type { DbHandle } from './db/client';

export interface RunningServer {
  server: ServerType;
  port: number;
  origin: string;
  stopCanvasJobs(): void;
}

/**
 * Binds to a fixed, predictable port starting at API_BASE_PORT, walking
 * forward on EADDRINUSE. The port must be knowable *before* the app is
 * created (not OS-assigned via port 0) because NextAuth-style session/CSRF
 * schemes — and our own Origin allowlist — are keyed off a stable origin.
 * A random port each launch would silently invalidate state on every
 * restart, which is exactly the bug this pins down.
 */
export async function startLocalServer(options: {
  dataRoot: string;
  devServerOrigin?: string;
  settingsStore?: SettingsStore;
  sessionStore?: SessionStore;
  skillsDirs?: string[];
  scheduleStore?: ScheduleStore;
  thoughtStore?: ThoughtStore;
  db?: DbHandle;
}): Promise<RunningServer> {
  let lastError: unknown;

  for (let attempt = 0; attempt < API_PORT_SCAN_ATTEMPTS; attempt += 1) {
    const port = API_BASE_PORT + attempt;
    const app = createApp({
      dataRoot: options.dataRoot,
      port,
      devServerOrigin: options.devServerOrigin,
      settingsStore: options.settingsStore,
      sessionStore: options.sessionStore,
      skillsDirs: options.skillsDirs,
      scheduleStore: options.scheduleStore,
      thoughtStore: options.thoughtStore,
      db: options.db,
    });

    try {
      const server = await new Promise<ServerType>((resolve, reject) => {
        const instance = serve(
          { fetch: app.fetch, hostname: '127.0.0.1', port },
          () => resolve(instance),
        );
        instance.once('error', reject);
      });
      app.startCanvasJobs();
      return { server, port, origin: `http://127.0.0.1:${port}`, stopCanvasJobs: app.stopCanvasJobs };
    } catch (err) {
      app.stopCanvasJobs();
      lastError = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      // Windows can reserve an otherwise unused port (Hyper-V / VPN) and return EACCES.
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
    }
  }

  throw new Error(
    `Could not find a free port in [${API_BASE_PORT}, ${API_BASE_PORT + API_PORT_SCAN_ATTEMPTS}): ${String(lastError)}`,
  );
}

export function stopLocalServer(running: RunningServer): Promise<void> {
  running.stopCanvasJobs();
  return new Promise((resolve) => {
    running.server.close(() => resolve());
    // Active NDJSON readers otherwise keep close() pending while Electron waits to quit.
    if ('closeAllConnections' in running.server && typeof running.server.closeAllConnections === 'function') {
      running.server.closeAllConnections();
    }
  });
}
