/**
 * Content that is about to be replayed into every future prompt (memories, harness rules, skills) is checked for the
 * things that must never be persisted: invisible characters used to hide instructions, and the stock phrasing of
 * prompt injection. Critical findings only; this is a tripwire, not a classifier, so it is deliberately narrow.
 * Secret-shaped values are handled by the older patterns in `assertMemorySafe` and by `redactSecrets`.
 */
export interface GuardFinding { reason: string }

// Zero-width space, word joiner & invisible operators, bidi overrides/isolates, LRM/RLM. ZWJ/ZWNJ are left alone:
// emoji sequences and some scripts depend on them.
const INVISIBLE = /[​‎‏‪-‮⁠-⁤⁦-⁩]/;
const MID_TEXT_BOM = /.﻿/s;

const INJECTION: Array<{ re: RegExp; reason: string }> = [
  { re: /ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i, reason: 'prompt injection ("ignore previous instructions")' },
  { re: /disregard\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|system)\s+(?:instructions?|prompts?|rules?)/i, reason: 'prompt injection ("disregard instructions")' },
  { re: /(?:忽略|无视|忘记|不要遵守)(?:之前|以前|上面|先前|前面|所有|全部|系统)[^\n。]{0,8}(?:指令|指示|提示词?|规则|要求)/, reason: 'prompt injection (忽略之前的指令)' },
  { re: /reveal\s+(?:your\s+|the\s+)?system\s+prompt|print\s+(?:your\s+|the\s+)?system\s+prompt/i, reason: 'prompt injection (reveal system prompt)' },
  { re: /(?:curl|wget|Invoke-WebRequest)\b[^\n]{0,80}(?:\.env|id_rsa|credentials|api[_-]?key|secret)/i, reason: 'credential exfiltration command' },
];

/** The first critical finding in `text`, or null. */
export function scanContent(text: string): GuardFinding | null {
  if (INVISIBLE.test(text)) return { reason: 'hidden invisible characters' };
  if (MID_TEXT_BOM.test(text)) return { reason: 'hidden byte-order mark inside the text' };
  for (const { re, reason } of INJECTION) if (re.test(text)) return { reason };
  return null;
}
