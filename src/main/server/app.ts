import { Hono, type MiddlewareHandler } from 'hono';
import { createFileSessionStore } from './storage/fileSessionStore';
import { createSettingsStore } from './storage/settingsStore';
import { createSessionsRouter } from './routes/sessions';
import { createChatRouter } from './routes/chat';
import { createSettingsRouter } from './routes/settings';
import { createSkillsRouter } from './routes/skills';
import { createSchedulesRouter } from './routes/schedules';
import { createScheduleStore } from './storage/scheduleStore';
import { createThoughtStore } from './storage/thoughtStore';

export interface CreateAppOptions {
  /** Directory the local session/settings JSON files live under. */
  dataRoot: string;
  /** Port the server itself is bound to, for Host-header validation. */
  port: number;
  /** Vite dev server origin in dev, so the renderer's fetches aren't rejected. */
  devServerOrigin?: string;
  settingsStore?: ReturnType<typeof createSettingsStore>;
  skillsDirs?: string[];
  scheduleStore?: ReturnType<typeof createScheduleStore>;
  thoughtStore?: ReturnType<typeof createThoughtStore>;
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
  if (options.devServerOrigin) allowedOrigins.add(options.devServerOrigin);

  return async (c, next) => {
    const host = c.req.header('host');
    if (host !== expectedHost) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (origin !== undefined) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
    await next();
  };
}

export function createApp(options: CreateAppOptions) {
  const sessionStore = createFileSessionStore(options.dataRoot);
  const settingsStore = options.settingsStore ?? createSettingsStore(options.dataRoot);

  const app = new Hono();
  app.use('*', originGuard(options));

  app.get('/api/health', (c) => c.json({ ok: true }));
  const skillsDirs = options.skillsDirs ?? [];
  app.route('/api/sessions', createSessionsRouter(sessionStore));
  app.route('/api/sessions', createChatRouter(sessionStore, settingsStore, skillsDirs));
  const scheduleStore = options.scheduleStore ?? createScheduleStore(options.dataRoot);
  const thoughtStore = options.thoughtStore ?? createThoughtStore(options.dataRoot);
  app.route('/api/settings', createSettingsRouter(settingsStore));
  app.route('/api/skills', createSkillsRouter(skillsDirs));
  app.route('/api/schedules', createSchedulesRouter(scheduleStore, thoughtStore));

  return app;
}
