// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import RegionMarkOverlay from './RegionMarkOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('offers box and pen annotation modes and switches between them', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<RegionMarkOverlay sessionId="s" node={{ id: 'n', type: 'image', title: 't', params: {} } as never} imageUrl="data:image/png;base64,AA==" onClose={() => undefined} />);
  });
  const group = document.body.querySelector('[aria-label="标注方式"]');
  expect(group).not.toBeNull();
  const [box, pen] = [...group!.querySelectorAll('button')];
  expect(box.getAttribute('aria-pressed')).toBe('true');
  await act(async () => { pen.click(); });
  expect(pen.getAttribute('aria-pressed')).toBe('true');
  expect(document.body.querySelector('svg[viewBox="0 0 1 1"]')).not.toBeNull();
  await act(async () => root.unmount());
});
