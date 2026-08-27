import { Hono } from 'hono';
import type { SettingsStore } from '../storage/settingsStore';
import type { Appearance, PermissionMode, SettingsPatch } from '../../../shared/settings';

const APPEARANCES = new Set<Appearance>(['system', 'light', 'dark']);
const PERMISSION_MODES = new Set<PermissionMode>(['ask', 'workspace', 'full']);

export function createSettingsRouter(settingsStore: SettingsStore) {
  const router = new Hono();

  router.get('/', async (c) => {
    return c.json(await settingsStore.getPublic());
  });

  router.put('/', async (c) => {
    const body = await c.req.json().catch((): null => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid body' }, 400);
    }

    const patch: SettingsPatch = {};

    if (body.appearance !== undefined) {
      if (!APPEARANCES.has(body.appearance)) {
        return c.json({ error: 'appearance must be system, light, or dark' }, 400);
      }
      patch.appearance = body.appearance;
    }

    if (body.permissionMode !== undefined) {
      if (!PERMISSION_MODES.has(body.permissionMode)) {
        return c.json({ error: 'permissionMode must be ask, workspace, or full' }, 400);
      }
      patch.permissionMode = body.permissionMode;
    }

    if (body.activeProviderId !== undefined) {
      if (typeof body.activeProviderId !== 'string') {
        return c.json({ error: 'activeProviderId must be a string' }, 400);
      }
      patch.activeProviderId = body.activeProviderId;
    }

    if (body.workspacePath !== undefined) {
      if (body.workspacePath !== null && typeof body.workspacePath !== 'string') {
        return c.json({ error: 'workspacePath must be a string or null' }, 400);
      }
      patch.workspacePath = body.workspacePath;
    }

    if (body.provider !== undefined) {
      if (!body.provider || typeof body.provider.id !== 'string') {
        return c.json({ error: 'provider.id is required' }, 400);
      }
      patch.provider = {
        id: body.provider.id,
        apiKey: body.provider.apiKey === undefined ? undefined : body.provider.apiKey,
        model: body.provider.model,
        baseUrl: body.provider.baseUrl,
      };
    }

    // Legacy desktop clients posted { openaiApiKey }.
    if (body.openaiApiKey !== undefined && !patch.provider) {
      if (typeof body.openaiApiKey !== 'string') {
        return c.json({ error: 'openaiApiKey must be a string' }, 400);
      }
      patch.provider = { id: 'openai', apiKey: body.openaiApiKey || null };
    }

    try {
      const settings = await settingsStore.applyPatch(patch);
      return c.json(settings);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return router;
}
