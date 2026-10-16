import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function patchSpeech(source) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const [from, to] of [['reizoSpeech.ts', 'src/agent/reizoSpeech.ts'], ['reizoSpeechJobs.ts', 'src/agent/reizoSpeechJobs.ts'], ['reizoSpeechIdentity.verify.ts', 'src/agent/reizoSpeechIdentity.verify.ts'], ['ReizoSpeechSettings.tsx', 'src/editor/ReizoSpeechSettings.tsx']]) copyFileSync(path.join(here, from), path.join(source, to));
  const patch = (relative, marker, anchor, replacement) => {
    const file = path.join(source, relative), code = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (code.includes(marker)) return;
    if (code.split(anchor).length !== 2) throw new Error(`Unexpected speech overlay anchor: ${relative}`);
    writeFileSync(file, code.replace(anchor, replacement));
  };
  patch('src/agent/tools.ts', "from './reizoSpeech'", "import type { AgentToolSchema }", "import { REIZO_SPEECH_SCHEMAS, execReizoSpeech } from './reizoSpeech';\nimport type { AgentToolSchema }");
  patch('src/agent/tools.ts', '...REIZO_SPEECH_SCHEMAS', '  ...CORE_TOOL_SCHEMAS,', '  ...REIZO_SPEECH_SCHEMAS,\n  ...CORE_TOOL_SCHEMAS,');
  patch('src/agent/tools.ts', "name === 'reizo_speech_job'", "  if (name === 'track_progress') {", "  if (name === 'reizo_speech_job') return execReizoSpeech(args, ctx);\n  if (name === 'track_progress') {");
  patch('src/agent/external-tool-policy.ts', "  'reizo_speech_job',", 'const DRAFT_EDIT_TOOL_NAMES = new Set([', "const DRAFT_EDIT_TOOL_NAMES = new Set([\n  'reizo_speech_job',");
  patch('shared/project-store-validation.ts', "key.startsWith('reizo-speech:')", 'export function projectIdFromProjectStoreKey(key: string): string | undefined {', "export function projectIdFromProjectStoreKey(key: string): string | undefined {\n  if (key.startsWith('reizo-speech:')) return /^reizo-speech:([a-zA-Z0-9_-]{1,160}):[a-f0-9]{64}$/.exec(key)?.[1];");
  // Generate identity at command creation, not during reducer replay. Otherwise
  // a reviewed subtitle correction points to different words after Apply/reload.
  patch('src/editor/reducerActions.ts', "words: TranscriptWord[]; transcriptGenerationId?: string", "type: 'setItemTranscript'; id: string; words: TranscriptWord[]", "type: 'setItemTranscript'; id: string; words: TranscriptWord[]; transcriptGenerationId?: string");
  patch('src/editor/storeCommandBuilder.ts', 'copyTranscriptIdentity, newTranscriptGeneration', "import { copyTranscriptIdentity }", "import { copyTranscriptIdentity, newTranscriptGeneration }");
  patch('src/editor/storeCommandBuilder.ts', 'transcriptGenerationId: identity.transcriptGenerationId', "setItemTranscript: (id, words) => dispatch({ type: 'setItemTranscript', id, words }),", "setItemTranscript: (id, words) => {\n        const identity = newTranscriptGeneration(words);\n        dispatch({ type: 'setItemTranscript', id, words: identity.transcript, transcriptGenerationId: identity.transcriptGenerationId });\n      },");
  patch('src/editor/reducerTranscriptActions.ts', 'a.transcriptGenerationId', '...newTranscriptGeneration(a.words),', '...(a.transcriptGenerationId ? { transcriptGenerationId: a.transcriptGenerationId, transcript: a.words.map(word => ({ ...word })) } : newTranscriptGeneration(a.words)),');
}
