// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import * as canvasStore from '../../state/canvasStore';
import AgentMiniPreview from './AgentMiniPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(canvasVisible: boolean, sessionId: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<AgentMiniPreview sessionId={sessionId} canvasVisible={canvasVisible} />); });
  return { host, unmount: () => act(async () => root.unmount()) };
}

const entry = { id: 'e1', tool: 'add_node', verb: 'add' as never, label: '编排 3 个节点', nodeIds: ['a', 'b', 'c'], at: Date.now(), status: 'running' as const };

test('shows the running action while the canvas is off screen, and nothing while it is visible', async () => {
  canvasStore.pushTrail('s-mini', entry);
  const away = await mount(false, 's-mini');
  expect(away.host.querySelector('[data-ui="canvas.mini-preview"]')?.textContent).toContain('编排 3 个节点');
  await away.unmount();
  const here = await mount(true, 's-mini');
  expect(here.host.querySelector('[data-ui="canvas.mini-preview"]')).toBeNull();
  await here.unmount();
});

test('renders nothing for a session whose agent has not touched the canvas', async () => {
  const idle = await mount(false, 's-idle');
  expect(idle.host.querySelector('[data-ui="canvas.mini-preview"]')).toBeNull();
  await idle.unmount();
});
