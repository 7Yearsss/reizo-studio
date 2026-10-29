// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './context-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  // jsdom has no layout; the menu only needs these to exist.
  window.matchMedia = window.matchMedia ?? (((query: string) => ({ matches: false, media: query, addEventListener() { /* noop */ }, removeEventListener() { /* noop */ }, addListener() { /* noop */ }, removeListener() { /* noop */ }, onchange: null as MediaQueryList['onchange'], dispatchEvent: () => false })) as unknown as typeof window.matchMedia);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const menus = (): number => document.querySelectorAll('[role="menu"]').length;

it('keeps no menu in the document while closed, mounts it on open and unmounts it after closing', async () => {
  act(() => {
    root.render(
      <>
        {[1, 2, 3].map((n) => (
          <ContextMenu key={n}>
            <ContextMenuTrigger><button type="button" data-row={n}>row {n}</button></ContextMenuTrigger>
            <ContextMenuContent><ContextMenuItem>打开</ContextMenuItem></ContextMenuContent>
          </ContextMenu>
        ))}
      </>,
    );
  });
  expect(menus()).toBe(0);

  const row = host.querySelector('button[data-row="2"]') as HTMLElement;
  act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 })); });
  expect(menus()).toBe(1);

  act(() => { document.querySelector('[role="menu"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  expect(menus()).toBe(0);
});
