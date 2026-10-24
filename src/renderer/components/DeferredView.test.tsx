// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createDeferredView } from './DeferredView';

afterEach(() => { vi.restoreAllMocks(); });

it('keeps the conversation mounted on a panel import failure and retries only that panel', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const importer = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
    .mockResolvedValueOnce({ default: () => <p>作品已加载</p> });
  const Panel = createDeferredView(importer, { label: '会话作品' });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<><p>对话内容仍在</p><Panel /></>); });
    expect(host.textContent).toContain('对话内容仍在');
    expect(host.textContent).toContain('未能加载会话作品');
    const button = host.querySelector('button');
    expect(button?.textContent).toContain('重试加载');
    await act(async () => { button!.click(); });
    expect(importer).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('作品已加载');
    expect(host.textContent).toContain('对话内容仍在');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
