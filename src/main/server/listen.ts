import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
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
    const app: Hono = createApp({
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
      return { server, port, origin: `http://127.0.0.1:${port}` };
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EADDRINUSE') throw err;
    }
  }

  throw new Error(
    `Could not find a free port in [${API_BASE_PORT}, ${API_BASE_PORT + API_PORT_SCAN_ATTEMPTS}): ${String(lastError)}`,
  );
}

export function stopLocalServer(running: RunningServer): Promise<void> {
  return new Promise((resolve) => {
    running.server.close(() => resolve());
  });
}
