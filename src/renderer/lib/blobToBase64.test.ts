import { describe, expect, it } from 'vitest';
import { blobToBase64 } from './blobToBase64';

describe('blobToBase64', () => {
  it('encodes a small blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const b64 = await blobToBase64(blob);
    expect(atob(b64)).toBe(String.fromCharCode(1, 2, 3, 4));
  });
});
