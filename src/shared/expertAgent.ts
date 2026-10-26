/**
 * An expert is a saved persona for the main agent: its own instructions, optionally its own model and a
 * limited toolset. Typing `@name` at the start of a message hands that message to the expert; the answer
 * stays in the same conversation. Stored as one AGENT.md-style file per expert.
 */
export interface ExpertAgent {
  /** File-safe id, derived from the name. */
  id: string;
  /** Shown name, also the primary @ handle. */
  name: string;
  /** Other handles that route to this expert (e.g. an English name). */
  aliases: string[];
  description: string;
  /** What the expert is told it is and how it works (the markdown body). */
  instructions: string;
  providerId?: string;
  model?: string;
  /** Same syntax as a skill's `allowed-tools`. Absent = the normal toolset. */
  allowedTools?: string;
  maxTurns?: number;
}

export const EXPERT_INSTRUCTIONS_MAX = 8_000;

export function expertIdFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'expert';
}

export function parseExpert(raw: string, fallbackId: string): ExpertAgent | null {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const fields: Record<string, string> = {};
  for (const line of text.slice(3, end).trim().split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  const name = fields.name?.trim();
  const instructions = text.slice(end + 4).trim();
  if (!name || !instructions) return null;
  const maxTurns = Number(fields['max-turns']);
  return {
    id: fallbackId,
    name,
    aliases: (fields.aliases ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    description: fields.description ?? '',
    instructions,
    ...(fields.provider ? { providerId: fields.provider } : {}),
    ...(fields.model ? { model: fields.model } : {}),
    ...(fields['allowed-tools'] ? { allowedTools: fields['allowed-tools'] } : {}),
    ...(Number.isInteger(maxTurns) && maxTurns > 0 ? { maxTurns } : {}),
  };
}

export function serializeExpert(expert: Omit<ExpertAgent, 'id'>): string {
  const oneLine = (value: string) => value.replace(/\s*\n\s*/g, ' ').trim();
  return [
    '---',
    `name: ${oneLine(expert.name)}`,
    ...(expert.aliases.length ? [`aliases: ${expert.aliases.map(oneLine).join(', ')}`] : []),
    ...(expert.description ? [`description: ${oneLine(expert.description)}`] : []),
    ...(expert.providerId ? [`provider: ${oneLine(expert.providerId)}`] : []),
    ...(expert.model ? [`model: ${oneLine(expert.model)}`] : []),
    ...(expert.allowedTools ? [`allowed-tools: ${oneLine(expert.allowedTools)}`] : []),
    ...(expert.maxTurns ? [`max-turns: ${expert.maxTurns}`] : []),
    '---',
    '',
    expert.instructions.trim(),
    '',
  ].join('\n');
}

/**
 * If the message starts with `@handle` (name or alias, longest first, followed by a space, punctuation or the
 * end), return that expert. The handle must be at the very start so an @ inside a sentence stays a file mention.
 */
export function findExpertMention(text: string, experts: ExpertAgent[]): ExpertAgent | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('@')) return null;
  const handles = experts.flatMap((expert) => [expert.name, ...expert.aliases].map((handle) => ({ handle, expert })));
  handles.sort((a, b) => b.handle.length - a.handle.length);
  const lower = trimmed.toLowerCase();
  for (const { handle, expert } of handles) {
    const at = `@${handle.toLowerCase()}`;
    if (!lower.startsWith(at)) continue;
    const next = trimmed.charAt(at.length);
    if (next === '' || /[\s,，:：、.。!！?？]/.test(next)) return expert;
    // A Chinese handle is routinely followed directly by the request ("@文案专家写一段…").
    if (/[一-鿿]/.test(handle.slice(-1))) return expert;
  }
  return null;
}
