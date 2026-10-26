/** The slice of Electron's context-menu params the model needs (kept structural so it is testable without Electron). */
export interface ContextMenuParams {
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  mediaType: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export type ContextMenuItem =
  | { type: 'separator' }
  | { type: 'role'; role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'; label: string; enabled: boolean }
  | { type: 'replace-word'; label: string; word: string }
  | { type: 'add-to-dictionary'; label: string; word: string }
  | { type: 'copy-image'; label: string }
  | { type: 'copy-link'; label: string; url: string };

const MAX_SUGGESTIONS = 8;
const COPYABLE_LINK = /^(https?:|mailto:)/i;

/**
 * What the native right-click menu offers. Editable fields get edit actions (so paste works at all), selections get
 * Copy, images get Copy Image (decoded by Chromium, never re-fetched), links get Copy Link. Returns [] when there is
 * nothing useful, in which case no menu is shown.
 */
export function buildContextMenuModel(params: ContextMenuParams): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const group = (...next: ContextMenuItem[]) => {
    if (next.length === 0) return;
    if (items.length > 0) items.push({ type: 'separator' });
    items.push(...next);
  };
  const flags = params.editFlags;

  if (params.isEditable) {
    if (params.misspelledWord) {
      const spelling: ContextMenuItem[] = params.dictionarySuggestions
        .slice(0, MAX_SUGGESTIONS)
        .map((word) => ({ type: 'replace-word', label: word, word }) as const);
      spelling.push({ type: 'add-to-dictionary', label: '添加到词典', word: params.misspelledWord });
      group(...spelling);
    }
    group(
      { type: 'role', role: 'undo', label: '撤销', enabled: flags.canUndo },
      { type: 'role', role: 'redo', label: '重做', enabled: flags.canRedo },
    );
    group(
      { type: 'role', role: 'cut', label: '剪切', enabled: flags.canCut },
      { type: 'role', role: 'copy', label: '复制', enabled: flags.canCopy },
      { type: 'role', role: 'paste', label: '粘贴', enabled: flags.canPaste },
      { type: 'role', role: 'selectAll', label: '全选', enabled: flags.canSelectAll },
    );
    return items;
  }

  if (params.mediaType === 'image') group({ type: 'copy-image', label: '复制图片' });
  if (params.linkURL && COPYABLE_LINK.test(params.linkURL)) group({ type: 'copy-link', label: '复制链接地址', url: params.linkURL });
  if (params.selectionText.trim()) group({ type: 'role', role: 'copy', label: '复制', enabled: flags.canCopy });
  return items;
}
