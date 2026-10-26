// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DeliverableCard, { deliverableOf } from './DeliverableCard';
import type { ToolCallPart } from '../../../shared/chat';
vi.mock('../../state/useTabStore', () => ({ useTabStore: (select: Function) => select({ tabs: [{ id: 'tab', sessionId: 's1' }], activeTabId: 'tab' }) }));
vi.mock('../../state/useUiStore', () => ({ useUiStore: (select: Function) => select({ rightPanelTab: null }) }));
vi.mock('../../state/useArtifactStore', () => ({ useArtifactStore: (select: Function) => select({ selectedIdBySession: {} }) }));

describe('downloadable chat file card', () => {
  const part: ToolCallPart = { type: 'tool', id: 'txt', name: 'generate_file', args: { filename: '出师表.txt' }, result: '{"ok":true,"artifactId":"file-1","name":"出师表.txt","version":1}' };
  it('keeps a preview card and a download action in settled chat history', () => {
    const file = deliverableOf(part);
    expect(file).not.toBeNull();
    const html = renderToString(<DeliverableCard part={part} file={file!} />);
    expect(html).toContain('出师表.txt');
    expect(html).toContain('下载');
    expect(html).toContain('点击在右侧打开');
  });
  it('does not promise a file for missing, pending or failed tool output', () => {
    expect(deliverableOf({ ...part, result: undefined })).toBeNull();
    expect(deliverableOf({ ...part, error: 'failed' })).toBeNull();
    expect(deliverableOf({ ...part, result: '{"ok":false,"artifactId":"fake","name":"fake.txt"}' })).toBeNull();
  });
});
