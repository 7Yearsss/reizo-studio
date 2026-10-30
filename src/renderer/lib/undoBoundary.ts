import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';

/**
 * Make what happens next its own undo step. Typing merges into one step (as usual), but a chip insertion or a paste
 * is a different kind of change: one Ctrl+Z takes back just that, not the sentence typed before it.
 * Call before the change (so it does not merge into earlier typing) and after (so later typing does not merge into it).
 */
export function closeUndoGroup(view: EditorView): void {
  view.dispatch(closeHistory(view.state.tr));
}
