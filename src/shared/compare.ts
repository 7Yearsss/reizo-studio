export interface CompareTarget { providerId: string; model: string }

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;
export const MAX_COMPARE_PROMPT = 20_000;

/** 2–4 distinct provider/model pairs, each with non-empty short strings; anything else is rejected as a whole. */
export function parseCompareTargets(value: unknown): CompareTarget[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: CompareTarget[] = [];
  for (const item of value) {
    const t = item as { providerId?: unknown; model?: unknown } | null;
    if (!t || typeof t.providerId !== 'string' || typeof t.model !== 'string') return null;
    const providerId = t.providerId.trim();
    const model = t.model.trim();
    if (!providerId || !model || providerId.length > 64 || model.length > 200) return null;
    const key = `${providerId}\u0000${model}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ providerId, model });
  }
  return out.length >= MIN_COMPARE && out.length <= MAX_COMPARE ? out : null;
}

export interface CompareResult extends CompareTarget { ok: boolean; text?: string; error?: string; ms: number }
