import { expect, it } from 'vitest';
import { EditorObservations } from './observations';
import type { EditorContext } from '../../../shared/videoEditorContext';

const context: EditorContext = { projectId: 'project', timeline: { id: 'timeline', name: '主序列', fps: 30, width: 1280, height: 720, itemCount: 2 }, playheadFrame: 17,
  selectedMedia: [{ id: 'old-version', name: '素材', kind: 'video', offline: false }], selectedClips: [], awaiting: 'review', exporting: false };
it('isolates conversations and expires selection without claiming a pending draft was applied', () => {
  let now = 1000; const observations = new EditorObservations(() => now);
  observations.update('a', context, [{ id: 'review', at: now, state: 'awaiting_review', message: '等待应用' }]);
  expect(observations.read('a').context?.selectedMedia[0].id).toBe('old-version');
  expect(observations.read('b')).toMatchObject({ connected: false, context: null, activities: [] });
  now += 6000;
  expect(observations.read('a')).toMatchObject({ connected: false, context: null });
  expect(observations.read('a').activities.map((event) => event.state)).toEqual(['awaiting_review']);
});
it('deduplicates heartbeat events and preserves save ordering when a heartbeat arrives late', () => {
  let now = 2000; const observations = new EditorObservations(() => now);
  observations.record('a', 'saved', '已入库');
  now = 3000;
  const saving = { id: 'saving', at: 1000, state: 'saving' as const, message: '保存中' };
  observations.update('a', context, [saving]); observations.update('a', context, [saving]);
  expect(observations.read('a').activities.map((event) => event.state)).toEqual(['saving', 'saved']);
  observations.disconnect('a'); expect(observations.read('a').context).toBeNull();
});
