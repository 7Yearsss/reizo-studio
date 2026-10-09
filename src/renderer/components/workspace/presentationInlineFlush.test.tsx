// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TiptapInlineTextEditor } from '../../vendor/presenton/text/TiptapInlineTextEditor';

it('flushes live rich text before the host commits, even with a pending animation frame', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(100);
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { /* Frame intentionally stays pending. */ });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  let latest = ''; let committed = '';
  const noop = (): void => { /* Not needed in this flush test. */ };
  try {
    await act(async () => root.render(<TiptapInlineTextEditor autoFocus={false} baseFont={{ family: 'Arial', size: 28 }} editorStyle={{}} runs={[{ text: 'Original' }]} onRunsChange={(runs) => { latest = runs.map((run) => run.type === 'latex' ? run.latex : run.text).join(''); }} onBlurOutside={() => { committed = latest; }} onCommitShortcut={noop} onEscape={noop} onSelectionChange={noop} />));
    const editor = host.querySelector('[contenteditable="true"]')!;
    await act(async () => { editor.textContent = 'Latest typed text'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Latest typed text' })); await Promise.resolve(); });
    await act(async () => { const event = new CustomEvent('reizo:flush-presentation-inline', { bubbles: true, cancelable: true }); host.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); });
    expect(committed).toBe('Latest typed text');
  } finally { await act(async () => root.unmount()); host.remove(); frame.mockRestore(); cancel.mockRestore(); }
});
