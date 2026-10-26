// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AskUserPrompt from './AskUserPrompt';
import type { PendingAsk } from '../../state/chatStore';

vi.mock('./DirectionCard', () => ({ default: ({ direction, onPick }: { direction: { title: string }; onPick: () => void }) => <button onClick={onPick}>{direction.title}</button> }));
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('requires a model as well as a visual direction and sends both selected answers', async () => {
  const onAnswer = vi.fn();
  const pending: PendingAsk = { id: 'video-settings', questions: [
    { id: 'style', kind: 'direction', prompt: '视觉方向', directions: [{ id: 'cinematic', title: '电影感' }] },
    { id: 'video_model', kind: 'choice', prompt: '视频模型', options: ['模型 A', '模型 B'] },
  ] };
  await act(async () => root.render(<AskUserPrompt pending={pending} onAnswer={onAnswer} />));
  expect(host.textContent).toContain('确认生成设置');
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '电影感')!.click());
  const next = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('下一步'))!;
  expect(next.disabled).toBe(true);
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === '模型 B')!.click());
  expect(next.disabled).toBe(false);
  await act(async () => next.click());
  expect(onAnswer).toHaveBeenCalledWith({ style: 'cinematic', video_model: '模型 B' });
});
