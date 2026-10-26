import { describe, expect, it } from 'vitest';
import { buildContextMenuModel, type ContextMenuParams } from './contextMenuModel';

const base: ContextMenuParams = {
  isEditable: false, selectionText: '', linkURL: '', mediaType: 'none', misspelledWord: '', dictionarySuggestions: [],
  editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
};
const kinds = (p: Partial<ContextMenuParams>) => buildContextMenuModel({ ...base, ...p }).map((i) => (i.type === 'role' ? i.role : i.type));

describe('buildContextMenuModel', () => {
  it('an editable field always offers paste, with states from the edit flags', () => {
    const items = buildContextMenuModel({ ...base, isEditable: true });
    expect(items.filter((i) => i.type === 'role').map((i) => i.type === 'role' && i.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    const paste = items.find((i) => i.type === 'role' && i.role === 'paste');
    expect(paste && paste.type === 'role' && paste.enabled).toBe(true);
    const cut = items.find((i) => i.type === 'role' && i.role === 'cut');
    expect(cut && cut.type === 'role' && cut.enabled).toBe(false);
  });

  it('puts at most 8 spelling suggestions and the dictionary action first', () => {
    const items = buildContextMenuModel({ ...base, isEditable: true, misspelledWord: 'teh', dictionarySuggestions: Array.from({ length: 12 }, (_, i) => `w${i}`) });
    expect(items.filter((i) => i.type === 'replace-word')).toHaveLength(8);
    expect(items[8].type).toBe('add-to-dictionary');
    expect(items[9].type).toBe('separator');
  });

  it('read-only text: copy only when something is selected', () => {
    expect(kinds({})).toEqual([]);
    expect(kinds({ selectionText: '  ' })).toEqual([]);
    expect(kinds({ selectionText: '报销流程' })).toEqual(['copy']);
  });

  it('images and safe links get their own actions; javascript: links do not', () => {
    expect(kinds({ mediaType: 'image' })).toEqual(['copy-image']);
    expect(kinds({ linkURL: 'https://a.test/x' })).toEqual(['copy-link']);
    expect(kinds({ linkURL: 'javascript:alert(1)' })).toEqual([]);
    expect(kinds({ mediaType: 'image', linkURL: 'https://a.test', selectionText: 'x' })).toEqual(['copy-image', 'separator', 'copy-link', 'separator', 'copy']);
  });
});
