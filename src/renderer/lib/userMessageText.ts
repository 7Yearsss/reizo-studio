import { splitPresentationContext } from '../../shared/presentationReferences';
import { splitDocumentContext } from '../../shared/documentReferences';
import { splitSheetContext } from '../../shared/sheetReferences';
import { splitCanvasRefs } from '../components/chat/CanvasRefChips';

const LEGACY_HTML_CONTEXT = /\n*<html-context>[^\n]*<\/html-context>/g;

/** What the user actually typed: the message with the machine-readable reference blocks the app appends removed. */
export function userMessageText(content: string): string {
  const presentation = splitPresentationContext(content.replace(LEGACY_HTML_CONTEXT, ''));
  const document = splitDocumentContext(presentation.text);
  const sheet = splitSheetContext(document.text);
  return splitCanvasRefs(sheet.text).text.trim();
}
