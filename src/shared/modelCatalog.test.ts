import { expect, it } from 'vitest';
import { parseModelCatalog } from './modelCatalog';
it('whitelists public metadata and validates protocol per model kind', () => {
  const value = { text: [] as unknown[], image: [] as unknown[], video: [{ id: 'wan', name: 'WAN', protocol: 'openai-video', apiKey: 'private', video: { startFrame: false, endFrame: false, camera: false, reference: false, apiKey: 'private' } }] };
  expect(JSON.stringify(parseModelCatalog(value))).not.toContain('private');
  expect(() => parseModelCatalog({ ...value, text: value.video })).toThrow('protocol');
  expect(() => parseModelCatalog({ ...value, video: [{ ...value.video[0], video: { ...value.video[0].video, minSeconds: -1 } }] })).toThrow('duration');
  expect(parseModelCatalog(undefined)).toBeUndefined();
});
