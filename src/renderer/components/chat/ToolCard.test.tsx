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
    expect(html).toContain('$ npm run typecheck');
  });
});
