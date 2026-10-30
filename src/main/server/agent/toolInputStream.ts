import type { ChatStreamEvent } from '../../../shared/stream';
import { partialStringFields } from '../../../shared/partialJson';

type Chunk = { type: string; [key: string]: unknown };

/** The argument fields worth showing while a tool call is still being written. */
const SHOWN_KEYS = ['path', 'command', 'query', 'pattern', 'url', 'filename', 'name'] as const;
/** Hard cap on text kept per call, and how much new text must arrive before we look again. */
const MAX_TEXT = 4000;
const STEP_CHARS = 160;
/** An HTML page being written is streamed whole (so the preview can follow it) but in coarse steps and under a cap. */
const HTML_MAX_TEXT = 300_000;
const HTML_STEP_CHARS = 3000;
const HTML_PATH = /.html?$/i;

/**
 * Only plain workspace / shell / web tools are shown early. Canvas, artifact and media tools have renderer-side
 * effects keyed off their `tool` events (trail entries, panel opening), which must fire once, on the real call.
 */
const EARLY_TOOLS: ReadonlySet<string> = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'find_files', 'grep', 'run_command', 'http_fetch', 'web_search']);

interface Open { name: string; text: string; scannedLen: number; lastArgs: string; html?: boolean }

/**
 * Turns the provider's streamed tool-call arguments into early, bounded `tool` events: the row appears as soon as the
 * model starts the call and its path / command fills in as it is written, instead of the card staying blank until the
 * whole argument blob has arrived. At most a handful of events per call; the final `tool` event still carries the full args.
 */
export function createToolInputStreamer(): { feed(chunk: Chunk): ChatStreamEvent | null } {
  const open = new Map<string, Open>();
  return {
    feed(chunk) {
      if (chunk.type === 'tool-input-start') {
        const id = typeof chunk.id === 'string' ? chunk.id : '';
        const name = typeof chunk.toolName === 'string' ? chunk.toolName : '';
        if (!id || !name || !EARLY_TOOLS.has(name)) return null;
        open.set(id, { name, text: '', scannedLen: 0, lastArgs: '{}' });
        return { type: 'tool', id, name, args: {} };
      }
      if (chunk.type === 'tool-input-end') {
        if (typeof chunk.id === 'string') open.delete(chunk.id);
        return null;
      }
      if (chunk.type !== 'tool-input-delta') return null;
      const id = typeof chunk.id === 'string' ? chunk.id : '';
      const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
      const call = open.get(id);
      if (!call || !delta) return null;
      const htmlLimit = Boolean(call.html);
      const limit = htmlLimit ? HTML_MAX_TEXT : MAX_TEXT;
      if (call.text.length >= limit) return null;
      call.text = (call.text + delta).slice(0, limit);
      // Look at the text early (the first field usually lands in the first few tokens), then only every STEP_CHARS.
      const step = call.html ? HTML_STEP_CHARS : STEP_CHARS;
      if (call.scannedLen > 0 && call.text.length - call.scannedLen < step) return null;
      call.scannedLen = call.text.length;
      const args = partialStringFields(call.text, call.html ? [...SHOWN_KEYS, 'content'] : SHOWN_KEYS);
      if (!call.html && call.name === 'write_file' && args.path && HTML_PATH.test(args.path)) call.html = true;
      const signature = JSON.stringify(args);
      if (signature === call.lastArgs || Object.keys(args).length === 0) return null;
      call.lastArgs = signature;
      return { type: 'tool', id, name: call.name, args };
    },
  };
}
