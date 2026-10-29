import { nextRegionIndex } from '../../shared/regionCycle';

/** Landmark regions in reading order: sidebar → conversation → composer → side panel. */
const REGION_SELECTORS = ['[data-ui="app.sidebar"]', '[role="log"]', '[data-ui="chat.composer"]', '[data-ui="app.panel"]'];
const FOCUSABLE = 'textarea, input, [contenteditable="true"], button, [href], [tabindex]:not([tabindex="-1"])';

function visibleRegions(): HTMLElement[] {
  return REGION_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => el.getClientRects().length > 0).slice(0, 1),
  );
}

/** F6 / Shift+F6: move keyboard focus to the next landmark region. Returns whether focus moved. */
export function focusNextRegion(reverse: boolean): boolean {
  const regions = visibleRegions();
  const active = document.activeElement;
  const current = regions.findIndex((el) => active !== null && el.contains(active));
  const next = regions[nextRegionIndex(regions.length, current, reverse)];
  if (!next) return false;
  // The conversation lands on its scrolling viewport (arrow keys then scroll it), not on the first button inside it.
  const target = next.matches('[data-ui="chat.composer"]')
    ? next.querySelector<HTMLElement>('[contenteditable="true"], textarea') ?? next
    : next.matches('[role="log"]')
      ? next.closest<HTMLElement>('section') ?? next
      : next.querySelector<HTMLElement>(FOCUSABLE) ?? next;
  if (!target.hasAttribute('tabindex') && !target.matches(FOCUSABLE)) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: false });
  return document.activeElement === target;
}
