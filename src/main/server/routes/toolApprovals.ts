import { Hono } from 'hono';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { writeTextAtomic } from '../storage/atomicFile';
import { configurePersistentAllow, listPersistentAllow, revokePersistentAllow } from '../agent/permissions';

const fileOf = (dataRoot: string) => path.join(dataRoot, 'tool-approvals.json');

function load(dataRoot: string): string[] {
  try {
    const value = JSON.parse(readFileSync(fileOf(dataRoot), 'utf8')) as { alwaysAllow?: unknown };
    return Array.isArray(value.alwaysAllow) ? value.alwaysAllow.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Standing "always allow" decisions for third-party MCP tools. Loaded at startup, written whenever one is added or
 * revoked. Control and always-ask tools can never be listed (permissions.ts refuses them).
 */
export function createToolApprovalsRouter(dataRoot: string) {
  configurePersistentAllow(load(dataRoot), (names) => {
    void writeTextAtomic(fileOf(dataRoot), JSON.stringify({ alwaysAllow: names }, null, 2)).catch((error) => console.warn('[tool-approvals] save failed', error));
  });
  const router = new Hono();
  router.get('/', (c) => c.json({ tools: listPersistentAllow() }));
  router.delete('/:name', (c) => {
    if (!revokePersistentAllow(c.req.param('name'))) return c.json({ error: 'Not on the list' }, 404);
    return c.body(null, 204);
  });
  return router;
}
