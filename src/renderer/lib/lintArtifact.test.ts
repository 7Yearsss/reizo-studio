import { describe, expect, it } from 'vitest';
import { lintArtifact } from './lintArtifact';

describe('lintArtifact', () => {
  it('detects purple gradient', () => {
    const html = '<div style="background: linear-gradient(135deg, #6366f1, #a855f7)">Hero</div>';
    const findings = lintArtifact(html);
    expect(findings.some((f) => f.id === 'purple-gradient')).toBe(true);
  });

  it('detects emoji in button or heading', () => {
    const html = '<button>🚀 立即启动</button>';
    const findings = lintArtifact(html);
    expect(findings.some((f) => f.id === 'emoji-icon')).toBe(true);
  });

  it('detects invented metrics', () => {
    const html = '<h1>10× faster than traditional tools</h1>';
    const findings = lintArtifact(html);
    expect(findings.some((f) => f.id === 'invented-metric')).toBe(true);
  });

  it('detects scrollIntoView', () => {
    const html = '<script>document.getElementById("target").scrollIntoView();</script>';
    const findings = lintArtifact(html);
    expect(findings.some((f) => f.id === 'scroll-into-view')).toBe(true);
  });

  it('returns clean on compliant html', () => {
    const html = `
      <section class="p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
        <h2 class="text-xl font-semibold">项目概览</h2>
        <p class="text-sm text-zinc-500">基于最新真实业务指标生成。</p>
      </section>
    `;
    const findings = lintArtifact(html);
    expect(findings).toHaveLength(0);
  });
});
