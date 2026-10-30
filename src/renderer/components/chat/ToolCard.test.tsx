// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ToolCard from './ToolCard';

describe('ToolCard command details', () => {
  it('shows the invocation parameters for file search tools', () => {
    const html = renderToString(
      <ToolCard
        part={{
          type: 'tool',
          id: 'tool-1',
          name: 'find_files',
          args: { query: 'src/renderer' },
        }}
      />,
    );
    expect(html).toContain('find_files --query &quot;src/renderer&quot;');
  });

  it('shows the actual shell command for run_command', () => {
    const html = renderToString(
      <ToolCard
        part={{
          type: 'tool',
          id: 'tool-2',
          name: 'run_command',
          args: { command: 'npm run typecheck' },
        }}
      />
    );
    expect(html).toContain('&quot;command&quot;: &quot;npm run typecheck&quot;');
  });
});

describe('ToolCard live HTML page', () => {
  const page = '<!doctype html><h1>Landing</h1><p>partial body that is still being written';
  const card = (over: Record<string, unknown>) =>
    renderToString(<ToolCard part={{ type: 'tool', id: 'w1', name: 'write_file', args: { path: 'index.html', content: page }, ...over } as never} />);

  it('previews the page while write_file is still running', () => {
    const html = card({});
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox=""');
  });

  it('stops previewing once the call has a result', () => {
    expect(card({ result: '{"ok":true}' })).not.toContain('<iframe');
  });

  it('does not preview non-HTML files', () => {
    expect(card({ args: { path: 'a.ts', content: page } })).not.toContain('<iframe');
  });
});
