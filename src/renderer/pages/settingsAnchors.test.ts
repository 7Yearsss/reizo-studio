import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SETTINGS_CATALOG } from '../../shared/settingsSearch';

const source = readFileSync(join(__dirname, 'SettingsPage.tsx'), 'utf8');

it('every anchor the search catalog points at exists in the settings page', () => {
  const declared = new Set([
    ...[...source.matchAll(/<SettingGroup id="([\w-]+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/data-setting-id="([\w-]+)"/g)].map((m) => m[1]),
  ]);
  for (const entry of SETTINGS_CATALOG) {
    if (entry.anchor) expect(declared.has(entry.anchor), `${entry.id} -> ${entry.anchor}`).toBe(true);
  }
});

it('every group the page declares is searchable', () => {
  const anchors = new Set(SETTINGS_CATALOG.map((e) => e.anchor).filter(Boolean));
  for (const m of source.matchAll(/<SettingGroup id="([\w-]+)"/g)) expect(anchors.has(m[1]), m[1]).toBe(true);
});
