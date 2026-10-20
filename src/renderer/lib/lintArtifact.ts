/**
 * Anti-AI-slop linter for generated HTML/UI artifacts.
 *
 * Adapted from Open Design's proven lint rules to detect common LLM-generated UI antipatterns:
 * - Purple/indigo AI cliché colors & trust gradients
 * - Emoji used as structural UI icons
 * - Generic AI cards (rounded + left border accent)
 * - Invented metrics and filler placeholder copy
 * - scrollIntoView() that breaks host iframe boundaries
 */

export type LintSeverity = 'P0' | 'P1' | 'P2';

export interface LintFinding {
  severity: LintSeverity;
  id: string;
  message: string;
  fix: string;
  snippet?: string;
}

const PURPLE_HEXES = [
  '#a855f7', '#9333ea', '#7c3aed', '#6d28d9', '#581c87',
  '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe',
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81',
  '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff', '#eef2ff',
];

const TRUST_GRADIENT_BLUE_HEXES = [
  '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
  '#60a5fa', '#93c5fd', '#bfdbfe',
  '#0ea5e9', '#0284c7', '#0369a1', '#38bdf8', '#7dd3fc',
];

const TRUST_GRADIENT_CYAN_HEXES = [
  '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63',
  '#22d3ee', '#67e8f9', '#a5f3fc',
];

const AI_DEFAULT_INDIGO = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
];

const SLOP_EMOJI = [
  '✨', '🚀', '🎯', '⚡', '🔥', '💡', '📈', '🎨', '🛡️', '🌟',
  '💪', '🎉', '👋', '🙌', '✅', '⭐', '🏆',
];

const INVENTED_METRIC_PATTERNS = [
  /\b10×\s+(faster|better|easier)\b/i,
  /\b100×\s+(faster|better)\b/i,
  /\b99\.\d+%\s+uptime\b/i,
  /\bzero[- ]downtime\b/i,
  /\b3×\s+more\s+(productive|efficient)\b/i,
];

const FILLER_PATTERNS = [
  /\bfeature\s+(one|two|three|1|2|3)\b/i,
  /\blorem\s+ipsum\b/i,
  /\bdolor\s+sit\s+amet\b/i,
  /\bplaceholder\s+text\b/i,
  /\bsample\s+content\b/i,
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clip(s: string, len = 90): string {
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function stripTokenBlocks(cssOrHtml: string): string {
  return cssOrHtml.replace(
    /(?::root|html|\[data-theme[^\]]*\])\s*\{[^}]*--accent\s*:\s*[^};]+;?[^}]*\}/gi,
    '',
  );
}

function detectBlueCyanTrustGradient(html: string): string | null {
  const gradientRe = /linear-gradient\(([^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = gradientRe.exec(html)) !== null) {
    const body = match[1]!.toLowerCase();
    const hasBlue =
      TRUST_GRADIENT_BLUE_HEXES.some((hex) => body.includes(hex.toLowerCase())) ||
      /\bblue\b/.test(body);
    const hasCyan =
      TRUST_GRADIENT_CYAN_HEXES.some((hex) => body.includes(hex.toLowerCase())) ||
      /\b(cyan|teal)\b/.test(body);
    if (hasBlue && hasCyan) return match[0];
  }
  return null;
}

/**
 * Lints an HTML or CSS string for AI design anti-patterns.
 */
export function lintArtifact(rawHtml: unknown): LintFinding[] {
  const out: LintFinding[] = [];
  if (typeof rawHtml !== 'string' || rawHtml.length === 0) return out;

  // Strip HTML comments to avoid false alarms from instructions
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');

  // 1. Purple gradient backgrounds (P0)
  for (const hex of PURPLE_HEXES) {
    const re = new RegExp(`linear-gradient\\([^)]*${escapeRe(hex)}[^)]*\\)`, 'i');
    const m = re.exec(html);
    if (m) {
      out.push({
        severity: 'P0',
        id: 'purple-gradient',
        message: `检测到紫色/靛蓝渐变 (${hex}) — 典型的 AI 模板视觉俗套。`,
        fix: '建议使用纯色背景表面（如 var(--bg) / var(--surface)）或结合特定品牌主色，避免紫色渐变。',
        snippet: clip(m[0]),
      });
      break;
    }
  }

  // 2. Blue -> cyan trust gradient (P0)
  if (out.find((f) => f.id === 'purple-gradient') === undefined) {
    const tg = detectBlueCyanTrustGradient(html);
    if (tg) {
      out.push({
        severity: 'P0',
        id: 'trust-gradient',
        message: '检测到蓝➔青两段式“信赖渐变” — SaaS 模板常见 AI 痕迹。',
        fix: '用平坦表面或克制的设计系统 Token 取代双色渐变。',
        snippet: clip(tg),
      });
    }
  }

  // 3. AI default indigo as solid accent (P0)
  if (out.find((f) => f.id === 'purple-gradient') === undefined) {
    const htmlForIndigo = stripTokenBlocks(html);
    for (const hex of AI_DEFAULT_INDIGO) {
      const re = new RegExp(escapeRe(hex), 'i');
      const m = re.exec(htmlForIndigo);
      if (m) {
        out.push({
          severity: 'P0',
          id: 'ai-default-indigo',
          message: `检测到默认 Tailwind Indigo 强调色 (${hex}) — 出现率极高的 AI 默认色。`,
          fix: '建议使用设计系统主题色 var(--accent)，若确实需要靛蓝应显式在全局主题中声明。',
          snippet: clip(m[0]),
        });
        break;
      }
    }
  }

  // 4. Emoji used as UI icons (P0)
  for (const e of SLOP_EMOJI) {
    if (html.includes(e)) {
      const re = new RegExp(
        `<(?:h[1-6]|button|li|span class="[^"]*icon[^"]*")[^>]*>[^<]*${escapeRe(e)}`,
        'i',
      );
      const m = re.exec(html);
      if (m) {
        out.push({
          severity: 'P0',
          id: 'emoji-icon',
          message: `标题或按钮中使用了 Emoji "${e}" 充当图标。`,
          fix: '使用 1.6–1.8px 单线 SVG 图标（如 Lucide/Heroicons）代替 Emoji。',
          snippet: clip(m[0]),
        });
        break;
      }
    }
  }

  // 5. Rounded card with left-border accent (P0)
  const leftAccentRe =
    /\.[a-z-]+\s*\{[^}]*border-left\s*:\s*\d+px\s+solid\s+[^;]+;[^}]*border-radius\s*:\s*[1-9]/i;
  const lam = leftAccentRe.exec(html);
  if (lam) {
    out.push({
      severity: 'P0',
      id: 'left-accent-card',
      message: '圆角卡片加左侧彩色高亮边框 — 经典的 AI Dashboard 卡片模板。',
      fix: '去掉 border-radius（直角）或去掉左侧彩色 border，采用微细边框加统一背景。',
      snippet: clip(lam[0]),
    });
  }

  // 6. Invented metric (P0)
  for (const re of INVENTED_METRIC_PATTERNS) {
    const m = re.exec(html);
    if (m) {
      out.push({
        severity: 'P0',
        id: 'invented-metric',
        message: `疑似虚构的数据宣传语: "${m[0]}"。`,
        fix: '移除无信源数据，或用占位符标注真实来源。',
        snippet: clip(m[0]),
      });
      break;
    }
  }

  // 7. Filler / lorem copy (P0)
  for (const re of FILLER_PATTERNS) {
    const m = re.exec(html);
    if (m) {
      out.push({
        severity: 'P0',
        id: 'filler-copy',
        message: `检测到占位填充文案: "${m[0]}"。`,
        fix: '用切合主题的真实文案代替，或精简版块。',
        snippet: clip(m[0]),
      });
      break;
    }
  }

  // 8. scrollIntoView break (P0)
  if (/\.scrollIntoView\s*\(/.test(html)) {
    out.push({
      severity: 'P0',
      id: 'scroll-into-view',
      message: '检测到 Element.scrollIntoView() — 在预览沙箱中会导致宿主外壳发生意外抖动跳转。',
      fix: '改用当前滚动容器的 scrollTo({ behavior: "smooth" })。',
    });
  }

  return out;
}
