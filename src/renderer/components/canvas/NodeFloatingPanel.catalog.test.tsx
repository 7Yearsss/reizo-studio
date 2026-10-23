// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../shared/canvas';
import NodeFloatingPanel from './NodeFloatingPanel';

vi.mock('@xyflow/react', () => ({ useStore: (selector: (state: unknown) => unknown) => selector({ nodeLookup: new Map() }) }));
vi.mock('../../state/useSettingsStore', () => ({ useSettingsStore: (selector: (state: unknown) => unknown) => selector({ settings: {
  activeProviderId: 'reizo-account', mediaModels: { video: 'wan3.0-video' }, providers: [{ id: 'reizo-account', catalog: { image: [], video: [{ id: 'wan3.0-video', name: 'WAN 3', protocol: 'openai-video', video: { startFrame: false, endFrame: false, reference: false, camera: false } }] } }],
} }) }));
vi.mock('../../state/canvasStore', () => ({ composerRefIds: (): string[] => [], setMentionComposer: vi.fn() }));
vi.mock('./NodePanelViewport', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./MentionTextArea', () => ({ default: (): null => null }));
vi.mock('./useAssetUrl', () => ({ useAssetUrl: (): undefined => undefined }));
vi.mock('./CameraDial', () => ({ default: () => <button aria-label="运镜" /> }));
vi.mock('./NodePanelSelect', () => ({ default: ({ label, options }: { label: string; options: { value: string; label: string }[] }) => <select aria-label={label}>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }));

it('uses account video options on canvas and hides unverified duration, ratio, camera and reference controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NodeFloatingPanel sessionId="fixture" node={{ id: 'fixture', type: 'video' } as CanvasNode} visible prompt="fixture" nodeType="video" onPromptChange={vi.fn()} onPromptCommit={vi.fn()} candidates={[]} upstreamSources={[]} running={false} onRun={vi.fn()} onModelChange={vi.fn()} onRatioChange={vi.fn()} onDurationChange={vi.fn()} onCameraChange={vi.fn()} />));
    await act(async () => { vi.advanceTimersByTime(150); });
    expect([...host.querySelectorAll('[aria-label="生成模型"] option')].map(item => item.getAttribute('value'))).toEqual(['__configured_model__', 'wan3.0-video']);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="生成参数"]')?.click());
    expect(host.textContent).toContain('时长与画幅使用模型默认值');
    for (const label of ['视频时长', '画幅比例', '运镜']) expect(host.querySelector(`[aria-label="${label}"]`)).toBeNull();
    expect([...host.querySelectorAll('button')].some(button => button.textContent === '参考')).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
