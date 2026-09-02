import { Hono, type MiddlewareHandler } from 'hono';
import type { SessionStore } from '../../shared/chat';
import { createFileSessionStore } from './storage/fileSessionStore';
import { createSettingsStore } from './storage/settingsStore';
import { createSessionsRouter } from './routes/sessions';
import { createChatRouter } from './routes/chat';
import { createSettingsRouter } from './routes/settings';
import { createSkillsRouter } from './routes/skills';
import { createSchedulesRouter } from './routes/schedules';
import { createScheduleStore } from './storage/scheduleStore';
import { createThoughtStore } from './storage/thoughtStore';
import { createProjectStore } from './storage/projectStore';
import { createArtifactStore } from './storage/artifactStore';
import { createLargeValueStore } from './storage/largeValueStore';
import { createProjectsRouter } from './routes/projects';
import { createArtifactsRouter, createSessionArtifactsRouter } from './routes/artifacts';
import { createRefsRouter } from './routes/refs';
import { createCanvasRouter } from './routes/canvas';
import { createCanvasStore } from './storage/canvasStore';
import type { DbHandle } from './db/client';

export interface CreateAppOptions {
  /** Directory the local session/settings JSON files live under. */
  dataRoot: string;
  /** Port the server itself is bound to, for Host-header validation. */
  port: number;
  /** Vite dev server origin in dev, so the renderer's fetches aren't rejected. */
  devServerOrigin?: string;
  settingsStore?: ReturnType<typeof createSettingsStore>;
  /** Injected session store. Defaults to the JSON file store when omitted. */
  sessionStore?: SessionStore;
  skillsDirs?: string[];
  scheduleStore?: ReturnType<typeof createScheduleStore>;
  thoughtStore?: ReturnType<typeof createThoughtStore>;
  /** SQLite handle. Required for the canvas feature; omitted in the JSON-only test app. */
  db?: DbHandle;
}

/**
 * `localhost` and `127.0.0.1` are the same loopback host but distinct origins.
 * Vite may report one while Electron's window loads the other (or a stale main
 * process keeps the old one after a renderer-only restart), so accept both
 * forms of the dev server origin rather than 403-ing every renderer fetch.
 */
function loopbackOriginVariants(origin: string): string[] {
  try {
    const url = new URL(origin);
    const variants = new Set([url.origin]);
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      variants.add(url.origin);
    } else if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost';
      variants.add(url.origin);
    }
    return [...variants];
  } catch {
    return [origin];
  }
}

/**
 * Loopback-only guard against DNS rebinding: reject any request whose Host
 * header isn't exactly this server's own 127.0.0.1:<port>, and any request
 * whose Origin isn't the app's own renderer (dev server in dev, `null` for
 * a packaged `file://` load). A page in the user's regular browser cannot
 * satisfy either check, even if it guesses the port.
 */
function originGuard(options: CreateAppOptions): MiddlewareHandler {
  const expectedHost = `127.0.0.1:${options.port}`;
  const allowedOrigins = new Set<string>(['null']);
  if (options.devServerOrigin) {
    for (const variant of loopbackOriginVariants(options.devServerOrigin)) {
      allowedOrigins.add(variant);
    }
  }

  return async (c, next) => {
    const host = c.req.header('host');
    if (host !== expectedHost) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // The renderer runs on the Vite dev server origin, a different port from
    // this API, so every JSON POST/PATCH/DELETE is cross-origin and the
    // browser sends a preflight OPTIONS first. Answer it here or the fetch
    // fails with "Failed to fetch" before the real request is ever sent.
    if (c.req.method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers':
          c.req.header('access-control-request-headers') ?? 'content-type',
        'Access-Control-Max-Age': '600',
      };
      if (origin !== undefined) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
      }
      return c.body(null, 204, headers);
    }

    await next();

    // Set CORS headers on the *final* response after the handler runs. The
    // chat/stream routes return a raw `Response` (NDJSON ReadableStream),
    // which Hono does not merge `c.header(...)` into — so the streamed
    // assistant reply would be blocked by the browser as a CORS error and
    // only surface after a reload. Mutating `c.res.headers` covers it.
    if (origin !== undefined) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.append('Vary', 'Origin');
    }
  };
}

export function createApp(options: CreateAppOptions) {
  const sessionStore = options.sessionStore ?? createFileSessionStore(options.dataRoot);
  const settingsStore = options.settingsStore ?? createSettingsStore(options.dataRoot);
  const projectStore = createProjectStore(options.dataRoot);
  const artifactStore = createArtifactStore(options.dataRoot);
  const largeValueStore = createLargeValueStore(options.dataRoot);

  const canvasStore = options.db ? createCanvasStore(options.db) : undefined;

  const app = new Hono();
  app.use('*', originGuard(options));

  app.get('/api/health', (c) => c.json({ ok: true }));
  const skillsDirs = options.skillsDirs ?? [];
  app.route('/api/sessions', createSessionsRouter(sessionStore, artifactStore));
  app.route(
    '/api/sessions',
    createChatRouter(sessionStore, settingsStore, skillsDirs, artifactStore, projectStore, largeValueStore, {
      canvasStore,
      dataRoot: options.dataRoot,
    }),
  );
  app.route('/api/sessions', createSessionArtifactsRouter(artifactStore, sessionStore));
  app.route('/api/artifacts', createArtifactsRouter(artifactStore));
  app.route('/api/refs', createRefsRouter(largeValueStore));
  app.route('/api/projects', createProjectsRouter(projectStore, sessionStore));
  const scheduleStore = options.scheduleStore ?? createScheduleStore(options.dataRoot);
  const thoughtStore = options.thoughtStore ?? createThoughtStore(options.dataRoot);
  app.route('/api/settings', createSettingsRouter(settingsStore));
  app.route('/api/skills', createSkillsRouter(skillsDirs));
  app.route('/api/schedules', createSchedulesRouter(scheduleStore, thoughtStore));

  if (canvasStore) {
    app.route(
      '/api/canvas',
      createCanvasRouter(canvasStore, settingsStore, sessionStore, options.dataRoot, artifactStore),
    );
  }

  return app;
}
