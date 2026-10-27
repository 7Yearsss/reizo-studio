/**
 * What a chat model can do, as far as we know. Every field is optional on purpose: a model we have no rule for
 * reports nothing rather than a guess, and callers fall back to a stated default. The built-in table is matched on
 * the model id (provider prefixes like "openai/" or "Qwen/" are ignored); a user override is a sparse delta that wins
 * field by field, so a later table update still reaches everything the user did not change.
 */
export interface ChatModelCapabilities {
  /** Max context in tokens. */
  contextWindow?: number;
  /** Accepts images as input. */
  vision?: boolean;
  /** Produces separate reasoning / thinking output. */
  reasoning?: boolean;
}

interface Rule { match: RegExp; caps: ChatModelCapabilities }

// First match wins, so more specific rules come first. Only values we are confident about.
const RULES: Rule[] = [
  { match: /^gpt-4o/, caps: { contextWindow: 128_000, vision: true } },
  { match: /^gpt-4\.1/, caps: { contextWindow: 1_000_000, vision: true } },
  { match: /^o[134](-|$)/, caps: { contextWindow: 200_000, reasoning: true } },
  { match: /^gemini-2\.5/, caps: { contextWindow: 1_000_000, vision: true, reasoning: true } },
  { match: /^gemini-2\.0/, caps: { contextWindow: 1_000_000, vision: true } },
  { match: /^claude-/, caps: { contextWindow: 200_000, vision: true } },
  { match: /^deepseek-reasoner/, caps: { contextWindow: 128_000, reasoning: true, vision: false } },
  { match: /^deepseek-(chat|v3)/, caps: { contextWindow: 128_000, vision: false } },
  { match: /^moonshot-v1-(8k)/, caps: { contextWindow: 8_000, vision: false } },
  { match: /^moonshot-v1-(32k)/, caps: { contextWindow: 32_000, vision: false } },
  { match: /^moonshot-v1-(128k|auto)/, caps: { contextWindow: 128_000, vision: false } },
  { match: /^glm-4\.5v/, caps: { contextWindow: 64_000, vision: true } },
  { match: /^glm-4\.5/, caps: { contextWindow: 128_000, reasoning: true, vision: false } },
];

/** Strip a routing prefix ("openai/gpt-4o" → "gpt-4o"), lower-case. */
function bareId(modelId: string): string {
  const id = modelId.trim().toLowerCase();
  const slash = id.lastIndexOf('/');
  return slash >= 0 ? id.slice(slash + 1) : id;
}

/** Known capabilities for a model id; `{}` when nothing is known. Fields in `override` win individually. */
export function chatModelCapabilities(modelId: string, override?: ChatModelCapabilities): ChatModelCapabilities {
  const id = bareId(modelId);
  const base = RULES.find((rule) => rule.match.test(id))?.caps ?? {};
  if (!override) return { ...base };
  const merged: ChatModelCapabilities = { ...base };
  if (override.contextWindow !== undefined) merged.contextWindow = override.contextWindow;
  if (override.vision !== undefined) merged.vision = override.vision;
  if (override.reasoning !== undefined) merged.reasoning = override.reasoning;
  return merged;
}

/** A short badge text for the model picker: only what is known ("视觉 · 推理 · 128K"); undefined when nothing is. */
export function capabilityBadge(modelId: string, override?: ChatModelCapabilities): string | undefined {
  const caps = chatModelCapabilities(modelId, override);
  const parts: string[] = [];
  if (caps.vision) parts.push('视觉');
  if (caps.reasoning) parts.push('推理');
  if (caps.contextWindow) parts.push(caps.contextWindow >= 1_000_000 ? `${caps.contextWindow / 1_000_000}M` : `${Math.round(caps.contextWindow / 1000)}K`);
  return parts.length ? parts.join(' · ') : undefined;
}

/** Context window to budget against: the known one, or the caller's stated default. */
export function contextWindowFor(modelId: string, fallback: number, override?: ChatModelCapabilities): number {
  const known = chatModelCapabilities(modelId, override).contextWindow;
  return known && known > 0 ? known : fallback;
}
