import type { JSONContent } from '@tiptap/core';
import type { DocumentContent } from './documentContent';

/**
 * Typesetting by rule: classify each block of a document (title, numbered headings, body) and give each role
 * its font, size, alignment, indent and spacing. The text is never touched, only how it is set.
 */

export type FormatRole = 'title' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'body';
export const FORMAT_ROLES: FormatRole[] = ['title', 'heading1', 'heading2', 'heading3', 'heading4', 'body'];
export const ROLE_LABELS: Record<FormatRole, string> = { title: '标题', heading1: '一级标题', heading2: '二级标题', heading3: '三级标题', heading4: '四级标题', body: '正文' };

export interface RoleFormat {
  /** Font stack: the first name is used for Latin text, the last for Chinese text; names in between are screen fallbacks. */
  font: string;
  /** Points. */
  size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  /** First-line indent in characters of this role's own size (2 = the usual two-character indent). */
  firstLineChars: number;
  /** Fixed line height in points, or a multiple of the font size when absent. */
  lineExact?: number;
  lineMultiple?: number;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface FormatSpec {
  id: string;
  name: string;
  /** Text colour for everything that is typeset (hex); null leaves each run's colour alone. */
  color: string | null;
  roles: Record<FormatRole, RoleFormat>;
}

const FANGSONG = '仿宋_GB2312,FangSong,仿宋_GB2312';
const HEITI = '黑体,SimHei,黑体';

/** 《党政机关公文格式》GB/T 9704-2012: 三号 (16pt) text, fixed 28pt lines, two-character indent. */
export const OFFICIAL_SPEC: FormatSpec = {
  id: 'official',
  name: '公文格式',
  color: '000000',
  roles: {
    title: { font: '方正小标宋简体,SimSun,方正小标宋简体', size: 22, bold: false, align: 'center', firstLineChars: 0, lineExact: 35, spaceAfter: 28 },
    heading1: { font: HEITI, size: 16, bold: false, align: 'justify', firstLineChars: 2, lineExact: 28 },
    heading2: { font: '楷体_GB2312,KaiTi,楷体_GB2312', size: 16, bold: false, align: 'justify', firstLineChars: 2, lineExact: 28 },
    heading3: { font: FANGSONG, size: 16, bold: true, align: 'justify', firstLineChars: 2, lineExact: 28 },
    heading4: { font: FANGSONG, size: 16, bold: false, align: 'justify', firstLineChars: 2, lineExact: 28 },
    body: { font: FANGSONG, size: 16, bold: false, align: 'justify', firstLineChars: 2, lineExact: 28 },
  },
};

/** A common undergraduate-thesis layout; schools differ, so a reference document can replace it. */
export const THESIS_SPEC: FormatSpec = {
  id: 'thesis',
  name: '论文格式',
  color: '000000',
  roles: {
    title: { font: HEITI, size: 18, bold: false, align: 'center', firstLineChars: 0, lineMultiple: 1.5, spaceBefore: 12, spaceAfter: 12 },
    heading1: { font: HEITI, size: 16, bold: false, align: 'center', firstLineChars: 0, lineMultiple: 1.5, spaceBefore: 12, spaceAfter: 6 },
    heading2: { font: HEITI, size: 14, bold: false, align: 'left', firstLineChars: 0, lineMultiple: 1.5, spaceBefore: 6, spaceAfter: 6 },
    heading3: { font: HEITI, size: 12, bold: false, align: 'left', firstLineChars: 0, lineMultiple: 1.5, spaceBefore: 6, spaceAfter: 3 },
    heading4: { font: 'Times New Roman,SimSun,宋体', size: 12, bold: true, align: 'left', firstLineChars: 0, lineMultiple: 1.5 },
    body: { font: 'Times New Roman,SimSun,宋体', size: 12, bold: false, align: 'justify', firstLineChars: 2, lineMultiple: 1.5 },
  },
};

export const FORMAT_PRESETS: FormatSpec[] = [OFFICIAL_SPEC, THESIS_SPEC];

// ---- classification -------------------------------------------------------------------------------------------

const CN = '零一二三四五六七八九十百';
const SENTENCE_END = /[。！？；.!?;:：，,]$/;

function textOf(node: JSONContent): string {
  return (node.content ?? []).map((n) => (n.type === 'hardBreak' ? ' ' : n.text ?? '')).join('');
}

/** The heading level a numbered line implies, or null. A line only counts as a heading when it is short and not a sentence. */
function numberedLevel(text: string): 1 | 2 | 3 | 4 | null {
  const t = text.trim();
  if (!t || t.length > 40 || SENTENCE_END.test(t)) return null;
  if (new RegExp(`^第[${CN}\\d]+[章部分篇]`).test(t)) return 1;
  if (new RegExp(`^第[${CN}\\d]+[节条]`).test(t)) return 2;
  if (new RegExp(`^[${CN}]+、`).test(t)) return 1;
  if (new RegExp(`^[（(][${CN}]+[）)]`).test(t)) return 2;
  // eslint-disable-next-line no-irregular-whitespace -- the full-width space after a heading number is intentional
  const decimal = /^(\d{1,2}(?:\.\d{1,2}){0,3})[\s　]+\S/.exec(t);
  if (decimal) return Math.min(4, decimal[1].split('.').length) as 1 | 2 | 3 | 4;
  if (/^\d{1,2}[.．、]\s*\S/.test(t)) return 3;
  if (/^[（(]\d{1,2}[）)]\s*\S/.test(t)) return 4;
  return null;
}

const DATE_LINE = /^\d{4}\s*年\s*\d{1,2}\s*月(\s*\d{1,2}\s*日)?$/;

/** One role per top-level block; null for blocks that are left alone (lists, tables, images, empty lines, a closing date). */
export function classifyBlocks(nodes: JSONContent[]): (FormatRole | null)[] {
  const roles: (FormatRole | null)[] = nodes.map((): FormatRole | null => null);
  let titleSeen = false;
  nodes.forEach((node, i) => {
    if (node.type !== 'paragraph' && node.type !== 'heading') return;
    const text = textOf(node).trim();
    if (!text) return;
    if (DATE_LINE.test(text)) return;
    const numbered = numberedLevel(text);
    if (!titleSeen) {
      titleSeen = true;
      const centered = node.attrs?.textAlign === 'center';
      if (numbered === null && text.length <= 60 && !SENTENCE_END.test(text) && (node.type === 'heading' || centered || i === 0 || nodes.slice(0, i).every((n) => !textOf(n).trim()))) { roles[i] = 'title'; return; }
    }
    if (numbered !== null) { roles[i] = `heading${numbered}` as FormatRole; return; }
    if (node.type === 'heading') { const level = Math.min(4, Math.max(1, Number(node.attrs?.level) || 1)); roles[i] = `heading${level}` as FormatRole; return; }
    roles[i] = 'body';
  });
  return roles;
}

// ---- applying -------------------------------------------------------------------------------------------------

export interface FormatResult {
  content: DocumentContent;
  /** Blocks per role that were typeset. */
  counts: Partial<Record<FormatRole, number>>;
  /** Blocks whose formatting actually changed. */
  changed: number;
}

const twips = (points: number) => Math.round(points * 20);

function formatNode(node: JSONContent, f: RoleFormat, spec: FormatSpec): JSONContent {
  const attrs: Record<string, unknown> = {
    ...node.attrs,
    textAlign: f.align,
    indentFirst: f.firstLineChars ? twips(f.firstLineChars * f.size) : null,
    indentLeft: null,
    spaceBefore: f.spaceBefore !== undefined ? twips(f.spaceBefore) : null,
    spaceAfter: f.spaceAfter !== undefined ? twips(f.spaceAfter) : null,
    lineExact: f.lineExact ?? null,
    lineSpacing: f.lineExact ? null : f.lineMultiple ?? null,
  };
  const content = (node.content ?? []).map((child): JSONContent => {
    if (child.type !== 'text') return child;
    const previous = child.marks?.find((m) => m.type === 'runStyle')?.attrs as { color?: string | null; highlight?: string | null; vert?: string | null } | undefined;
    const marks: NonNullable<JSONContent['marks']> = (child.marks ?? []).filter((m) => m.type !== 'runStyle' && m.type !== 'bold');
    marks.push({ type: 'runStyle', attrs: { color: spec.color ?? previous?.color ?? null, size: f.size, font: f.font, highlight: previous?.highlight ?? null, vert: previous?.vert ?? null } });
    if (f.bold) marks.push({ type: 'bold' });
    return { ...child, marks };
  });
  return { ...node, attrs, content };
}

/** Typeset a document by a spec. Pure: the input is not modified, and nothing but formatting changes. */
export function applyFormat(content: DocumentContent, spec: FormatSpec): FormatResult {
  const nodes = content.doc.content ?? [];
  const roles = classifyBlocks(nodes);
  const counts: Partial<Record<FormatRole, number>> = {};
  let changed = 0;
  const next = nodes.map((node, i) => {
    const role = roles[i];
    if (!role) return node;
    counts[role] = (counts[role] ?? 0) + 1;
    const out = formatNode(node, spec.roles[role], spec);
    if (JSON.stringify(out) !== JSON.stringify(node)) changed++;
    return out;
  });
  return { content: { ...content, doc: { ...content.doc, content: next } }, counts, changed };
}

// ---- learning a spec from a reference document ---------------------------------------------------------------

function mode<T>(values: T[]): T | undefined {
  const tally = new Map<string, { value: T; n: number }>();
  for (const value of values) { const key = JSON.stringify(value); const hit = tally.get(key); if (hit) hit.n++; else tally.set(key, { value, n: 1 }); }
  return [...tally.values()].sort((a, b) => b.n - a.n)[0]?.value;
}

/**
 * Read the layout a reference document already has: for each role, the most common font, size, alignment, indent
 * and spacing among its blocks. Roles the reference does not use fall back to its body (then to the official layout).
 */
export function specFromContent(content: DocumentContent, name: string): FormatSpec {
  const nodes = content.doc.content ?? [];
  const roles = classifyBlocks(nodes);
  const typography = content.docx?.typography;
  const learned: Partial<Record<FormatRole, RoleFormat>> = {};
  for (const role of FORMAT_ROLES) {
    const samples = nodes.filter((_, i) => roles[i] === role);
    if (!samples.length) continue;
    const runs = samples.map((n) => (n.content ?? []).find((c) => c.type === 'text'));
    const styles = runs.map((r) => r?.marks?.find((m) => m.type === 'runStyle')?.attrs as { font?: string | null; size?: number | null } | undefined);
    const size = mode(styles.map((s) => s?.size ?? typography?.fontSize ?? 12)) ?? 12;
    const font = mode(styles.map((s) => s?.font ?? typography?.fontFamily ?? '宋体')) ?? '宋体';
    const first = mode(samples.map((n) => Number(n.attrs?.indentFirst) || 0)) ?? 0;
    learned[role] = {
      font, size,
      bold: (mode(runs.map((r) => Boolean(r?.marks?.some((m) => m.type === 'bold')))) ?? false),
      align: (mode(samples.map((n) => String(n.attrs?.textAlign ?? 'left'))) as RoleFormat['align']) ?? 'left',
      firstLineChars: first > 0 ? Math.round((first / 20 / size) * 2) / 2 : 0,
      ...pickLine(samples, typography?.lineHeight),
      ...spacing(samples),
    };
  }
  const body = learned.body ?? OFFICIAL_SPEC.roles.body;
  const rolesOut = Object.fromEntries(FORMAT_ROLES.map((role) => [role, learned[role] ?? (role === 'body' ? body : { ...OFFICIAL_SPEC.roles[role], ...(learned.body ? { font: body.font } : {}) })])) as Record<FormatRole, RoleFormat>;
  return { id: 'reference', name, color: null, roles: rolesOut };
}

function pickLine(samples: JSONContent[], fallbackMultiple?: number): Pick<RoleFormat, 'lineExact' | 'lineMultiple'> {
  const exact = mode(samples.map((n) => Number(n.attrs?.lineExact) || 0).filter(Boolean));
  if (exact) return { lineExact: exact };
  const multiple = mode(samples.map((n) => Number(n.attrs?.lineSpacing) || 0).filter(Boolean)) ?? fallbackMultiple;
  return multiple ? { lineMultiple: multiple } : {};
}

function spacing(samples: JSONContent[]): Pick<RoleFormat, 'spaceBefore' | 'spaceAfter'> {
  const before = mode(samples.map((n) => Number(n.attrs?.spaceBefore) || 0)) ?? 0;
  const after = mode(samples.map((n) => Number(n.attrs?.spaceAfter) || 0)) ?? 0;
  return { ...(before ? { spaceBefore: before / 20 } : {}), ...(after ? { spaceAfter: after / 20 } : {}) };
}
