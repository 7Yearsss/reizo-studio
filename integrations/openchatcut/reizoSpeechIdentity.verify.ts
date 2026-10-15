import assert from 'node:assert/strict';
import { INITIAL } from '../editor/initial';
import { docFromTimeline } from '../persist/projectStore';
import { makeDraft, replayActions } from '../editor/store';
import { activeEditorState } from '../editor/types';
import { resolveCaptionWordRefs, resolveCaptionWords, resolveCaptionWordIndices, applyWordOverrides } from '../captions/resolve';
import { applyDisplayTextEntries } from '../agent/tools/captions-word-overrides';

const base = docFromTimeline({ ...INITIAL, items: [{ id: 'speech', kind: 'video', name: 'Speech', src: '/media/a.mp4', track: 'track_v1', startFrame: 0, durationInFrames: 150 }] });
const draft = makeDraft(base), words = [{ text: '倒入', start: 500, end: 1200 }];
draft.commands.setItemTranscript('speech', words);
draft.commands.setCaptions({ enabled: true, sourceItemId: 'speech', template: 'plain', pacing: 'phrase' });
let state = draft.getState();
const refs = resolveCaptionWordRefs(state.captions!, state.items, state.fps);
const corrected = applyDisplayTextEntries([{ wordRef: refs[0], text: '导入' }], state.captions!, state.items, state.fps);
assert.equal(corrected.errors.length, 0);
draft.commands.updateCaptions({ wordOverrides: corrected.wordOverrides });
const actions = JSON.parse(JSON.stringify(draft.takeActions()));
for (let reload = 0; reload < 3; reload++) {
  const replayed = replayActions(base, actions);
  assert.deepEqual(replayed, draft.getDoc(), 'Persisted draft replay must retain transcript generation and word identities');
  state = activeEditorState(replayed);
  const currentRefs = resolveCaptionWordRefs(state.captions!, state.items, state.fps);
  assert.deepEqual(currentRefs, refs);
  const shown = applyWordOverrides(resolveCaptionWords(state.captions!, state.items, state.fps), resolveCaptionWordIndices(state.captions!, state.items, state.fps), state.captions!.wordOverrides, currentRefs);
  assert.equal(shown.words[0].text, '导入', 'Corrected display text must survive Apply and reload');
  assert.equal(state.items[0].transcript![0].text, '倒入', 'Source recognition remains unchanged');
}
draft.commands.setItemTranscript('speech', words);
state = draft.getState();
assert.notDeepEqual(resolveCaptionWordRefs(state.captions!, state.items, state.fps), refs, 'A genuinely new transcription still gets a new generation');
console.log('Transcript identity survives persisted draft replay / apply; display correction and fresh-generation isolation pass.');
