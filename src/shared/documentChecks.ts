/**
 * Deterministic whole-document consistency checks. Findings carry exact block ids and offsets (and,
 * where there is one obvious fix, the replacement), so the agent can turn them into reviewable edits
 * instead of guessing where the problems are.
 */

export interface CheckBlock { id: string; type: string; text: string }

export type CheckKind = 'numbering' | 'punctuation' | 'date-format' | 'number-format' | 'spacing' | 'repeated-word' | 'repeated-paragraph' | 'term';

export interface CheckFinding {
  kind: CheckKind;
  blockId: string;
  start: number;
  end: number;
  /** The text at start..end. */
  text: string;
  message: string;
  /** The obvious fix for start..end, when there is exactly one. */
  replacement?: string;
}

export interface TermRule { preferred: string; variants: string[] }

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff';
const CHINESE_NUMERALS = '零一二三四五六七八九十百';

/** ASCII punctuation sitting directly against Chinese text, and the full-width mark Chinese writing uses. */
const FULLWIDTH: Record<string, string> = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！', '(': '（', ')': '）' };
const PUNCT_AFTER_CJK = new RegExp(`([${CJK}])([,;:?!])(?=\\s|$|[${CJK}])`, 'g');
const PAREN_AROUND_CJK = new RegExp(`\\(([^()\\n]*[${CJK}][^()\\n]*)\\)`, 'g');

function isChineseText(text: string): boolean {
  const cjk = (text.match(new RegExp(`[${CJK}]`, 'g')) ?? []).length;
  return cjk >= 4 && cjk >= text.replace(/\s/g, '').length * 0.3;
}

function toArabic(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let current = 0;
  for (const ch of value) {
    if (ch in digits) current = digits[ch];
    else if (ch === '十') { total += (current || 1) * 10; current = 0; }
    else if (ch === '百') { total += (current || 1) * 100; current = 0; }
    else return null;
  }
  return total + current;
}

const NUMBERING_LEVELS: { level: string; pattern: RegExp }[] = [
  { level: '一、', pattern: new RegExp(`^\\s*([${CHINESE_NUMERALS}]+)、`) },
  { level: '（一）', pattern: new RegExp(`^\\s*[（(]([${CHINESE_NUMERALS}]+)[）)]`) },
  { level: '1.', pattern: /^\s*(\d{1,3})[.．、](?!\d)/ },
  { level: '（1）', pattern: /^\s*[（(](\d{1,3})[）)]/ },
  { level: '第一章', pattern: new RegExp(`^\\s*第([${CHINESE_NUMERALS}\\d]+)[章节条]`) },
];

function checkNumbering(blocks: CheckBlock[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const { level, pattern } of NUMBERING_LEVELS) {
    // Items of one level are numbered in sequence until a higher-level item starts a new run.
    let expected = 1;
    let previousAt = -1;
    blocks.forEach((block, index) => {
      if (block.type !== 'paragraph' && block.type !== 'heading') return;
      const match = pattern.exec(block.text);
      if (!match) return;
      const n = toArabic(match[1]);
      if (n === null) return;
      // A fresh "1" after something else restarts the count (a new list, a new section).
      if (n === 1 && previousAt >= 0 && index - previousAt > 0 && n !== expected) expected = 1;
      if (n !== expected) {
        findings.push({
          kind: 'numbering', blockId: block.id, start: match[0].length - match[0].trimStart().length, end: match[0].length,
          text: match[0].trim(), message: `${level} 序号应为 ${expected}，这里是 ${n}（编号${n > expected ? '跳号' : '重复或倒退'}）`,
        });
      }
      expected = n + 1;
      previousAt = index;
    });
  }
  return findings;
}

function checkPunctuation(block: CheckBlock): CheckFinding[] {
  if (!isChineseText(block.text)) return [];
  const findings: CheckFinding[] = [];
  for (const m of block.text.matchAll(PUNCT_AFTER_CJK)) {
    const at = (m.index ?? 0) + 1;
    findings.push({ kind: 'punctuation', blockId: block.id, start: at, end: at + 1, text: m[2], replacement: FULLWIDTH[m[2]], message: `中文句子里用了半角“${m[2]}”，应为“${FULLWIDTH[m[2]]}”` });
  }
  for (const m of block.text.matchAll(PAREN_AROUND_CJK)) {
    const at = m.index ?? 0;
    findings.push({ kind: 'punctuation', blockId: block.id, start: at, end: at + m[0].length, text: m[0], replacement: `（${m[1]}）`, message: '中文内容的括号应使用全角“（）”' });
  }
  return findings;
}

const DATE_FORMATS: { name: string; pattern: RegExp }[] = [
  { name: 'YYYY年M月D日', pattern: /\b\d{4}年\d{1,2}月\d{1,2}日/g },
  { name: 'YYYY-MM-DD', pattern: /\b\d{4}-\d{1,2}-\d{1,2}\b/g },
  { name: 'YYYY/MM/DD', pattern: /\b\d{4}\/\d{1,2}\/\d{1,2}\b/g },
  { name: 'YYYY.MM.DD', pattern: /\b\d{4}\.\d{1,2}\.\d{1,2}\b/g },
];

function checkDates(blocks: CheckBlock[]): CheckFinding[] {
  const hits = DATE_FORMATS.map((format) => ({ format, found: blocks.flatMap((b) => [...b.text.matchAll(format.pattern)].map((m) => ({ block: b, at: m.index ?? 0, text: m[0] }))) })).filter((h) => h.found.length);
  if (hits.length < 2) return [];
  hits.sort((a, b) => b.found.length - a.found.length);
  const main = hits[0].format.name;
  const findings: CheckFinding[] = [];
  for (const { format, found } of hits.slice(1)) {
    for (const f of found) findings.push({ kind: 'date-format', blockId: f.block.id, start: f.at, end: f.at + f.text.length, text: f.text, message: `日期写法与全文多数（${main}）不一致，这里是 ${format.name}` });
  }
  return findings;
}

function checkNumberFormats(blocks: CheckBlock[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const withComma: { block: CheckBlock; at: number; text: string }[] = [];
  const plainLarge: typeof withComma = [];
  for (const block of blocks) {
    for (const m of block.text.matchAll(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/g)) withComma.push({ block, at: m.index ?? 0, text: m[0] });
    for (const m of block.text.matchAll(/(?<![\d.,-])\d{5,10}(?![\d,.])/g)) plainLarge.push({ block, at: m.index ?? 0, text: m[0] });
  }
  if (withComma.length && plainLarge.length) {
    const minority = withComma.length >= plainLarge.length ? plainLarge : withComma;
    const useComma = withComma.length >= plainLarge.length;
    for (const f of minority) {
      findings.push({
        kind: 'number-format', blockId: f.block.id, start: f.at, end: f.at + f.text.length, text: f.text,
        replacement: useComma ? f.text.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : f.text.replace(/,/g, ''),
        message: useComma ? '大数字未使用千分位，与全文多数写法不一致' : '大数字使用了千分位，与全文多数写法不一致',
      });
    }
  }
  return findings;
}

function checkSpacing(block: CheckBlock): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const m of block.text.matchAll(/ {2,}| +$|^ +/g)) {
    const at = m.index ?? 0;
    const trailing = at + m[0].length === block.text.length;
    if (at === 0 && trailing) continue; // a blank line
    if (at === 0 && !trailing) { findings.push({ kind: 'spacing', blockId: block.id, start: 0, end: m[0].length, text: m[0], replacement: '', message: '段首有多余空格' }); continue; }
    findings.push({ kind: 'spacing', blockId: block.id, start: at, end: at + m[0].length, text: m[0], replacement: trailing ? '' : ' ', message: trailing ? '段尾有多余空格' : '连续多个空格' });
  }
  return findings;
}

function checkRepeats(block: CheckBlock): CheckFinding[] {
  const findings: CheckFinding[] = [];
  // "的的", "了了" and similar doubled function words; deliberate reduplication (天天, 看看) is left alone.
  for (const m of block.text.matchAll(/([的了在])\1/g)) {
    const at = m.index ?? 0;
    findings.push({ kind: 'repeated-word', blockId: block.id, start: at, end: at + 2, text: m[0], replacement: m[1], message: `重复用字“${m[0]}”` });
  }
  for (const m of block.text.matchAll(/\b([A-Za-z]{2,})\s+\1\b/gi)) {
    const at = m.index ?? 0;
    findings.push({ kind: 'repeated-word', blockId: block.id, start: at, end: at + m[0].length, text: m[0], replacement: m[1], message: `重复单词“${m[1]}”` });
  }
  return findings;
}

function checkRepeatedParagraphs(blocks: CheckBlock[]): CheckFinding[] {
  const seen = new Map<string, CheckBlock>();
  const findings: CheckFinding[] = [];
  for (const block of blocks) {
    const key = block.text.trim();
    if (block.type !== 'paragraph' || key.length < 24) continue;
    const first = seen.get(key);
    if (first) findings.push({ kind: 'repeated-paragraph', blockId: block.id, start: 0, end: block.text.length, text: key.slice(0, 60), message: '与前文某一段完全重复' });
    else seen.set(key, block);
  }
  return findings;
}

function checkTerms(blocks: CheckBlock[], rules: TermRule[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const rule of rules) {
    for (const variant of rule.variants.filter((v) => v && v !== rule.preferred)) {
      for (const block of blocks) {
        let from = 0;
        for (;;) {
          const at = block.text.indexOf(variant, from);
          if (at < 0) break;
          findings.push({ kind: 'term', blockId: block.id, start: at, end: at + variant.length, text: variant, replacement: rule.preferred, message: `术语应统一为“${rule.preferred}”` });
          from = at + variant.length;
        }
      }
    }
  }
  return findings;
}

export const DEFAULT_MAX_FINDINGS = 50;

export function checkDocument(blocks: CheckBlock[], options: { terms?: TermRule[]; max?: number } = {}): { findings: CheckFinding[]; total: number; counts: Record<string, number> } {
  const text = blocks.filter((b) => b.type === 'paragraph' || b.type === 'heading');
  const all = [
    ...checkNumbering(blocks),
    ...text.flatMap(checkPunctuation),
    ...checkDates(text),
    ...checkNumberFormats(text),
    ...text.flatMap(checkSpacing),
    ...text.flatMap(checkRepeats),
    ...checkRepeatedParagraphs(text),
    ...checkTerms(text, options.terms ?? []),
  ];
  const order = new Map(blocks.map((b, i) => [b.id, i]));
  all.sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0) || a.start - b.start);
  const counts: Record<string, number> = {};
  for (const f of all) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return { findings: all.slice(0, options.max ?? DEFAULT_MAX_FINDINGS), total: all.length, counts };
}
