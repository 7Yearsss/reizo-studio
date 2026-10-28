// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VideoAnalysisCard from './VideoAnalysisCard';
import type { ToolCallPart } from '../../../shared/chat';

let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const part: ToolCallPart = { type: 'tool', id: 'v', name: 'analyze_video', args: { url: 'https://x.com/user/status/123' } };
it('distinguishes loading, observed frames, and errors without calling untranscribed audio analysed', async () => {
  await act(async () => root.render(<VideoAnalysisCard part={part} />));
  expect(container.textContent).toContain('正在分析视频'); expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => root.render(<VideoAnalysisCard part={{ ...part, result: JSON.stringify({ kind: 'video-analysis', duration: 152, frames: [1, 2], audio: 'not-transcribed' }) }} />));
  expect(container.textContent).toContain('2:32'); expect(container.textContent).toContain('2 帧'); expect(container.textContent).toContain('音频未转写');
  await act(async () => root.render(<VideoAnalysisCard part={{ ...part, result: JSON.stringify({ ok: false, error: '请先登录' }) }} />));
  expect(container.textContent).toContain('视频分析失败'); expect(container.textContent).toContain('请先登录');
});
