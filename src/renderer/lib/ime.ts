import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** True while a CJK IME is composing, including the keydown-before-compositionend race. */
export function isImeComposingEvent(
  event: ReactKeyboardEvent | KeyboardEvent,
  composing = false,
): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return (
    composing ||
    native.isComposing === true ||
    // Legacy IME signal used by some Chromium/IME combinations.
    ('keyCode' in native && native.keyCode === 229)
  );
}
