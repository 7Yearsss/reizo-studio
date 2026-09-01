// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import WorkGroupCard from './WorkGroupCard';

describe('WorkGroupCard', () => {
  it('labels a settled tool group as finished, never as an ambiguous process', () => {
    const html = renderToString(
      <WorkGroupCard
        parts={[
          { type: 'tool', id: 't1', name: 'read_file', args: { path: 'a.ts' }, result: 'ok' },
        ]}
      />,
    );
    expect(html).toContain('工作完成');
    expect(html).not.toContain('工作过程');
  });

  it('labels an in-flight tool group as running', () => {
    const html = renderToString(
      <WorkGroupCard
        streaming
        parts={[{ type: 'tool', id: 't1', name: 'read_file', args: { path: 'a.ts' } }]}
      />,
    );
    expect(html).toContain('正在使用工具');
    expect(html).not.toContain('工作完成');
    expect(html).not.toContain('正在回复');
  });

  it('does not reserve a blank 220px well under a thinking-only run', () => {
    const html = renderToString(
      <WorkGroupCard
        streaming
        activities={[{ id: 'th1', kind: 'thinking', status: 'running', startedAt: 1 }]}
      />,
    );
    expect(html).toContain('正在思考');
    expect(html).not.toContain('思考中');
    expect(html).not.toMatch(/height:\s*220/);
    expect(html).not.toContain('>0<');
  });

  it('does not call a failed turn 工作完成', () => {
    const html = renderToString(
      <WorkGroupCard
        durationMs={300_000}
        turnOutcome="error"
        parts={[
          { type: 'tool', id: 't1', name: 'read_file', args: { path: 'a.ts' }, result: 'ok' },
        ]}
      />,
    );
    expect(html).toContain('工作失败');
    expect(html).not.toContain('工作完成');
  });
});
