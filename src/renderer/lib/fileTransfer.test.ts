// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { hasTransferredFiles, isImageFile, transferredFiles } from './fileTransfer';

it('extracts an in-memory screenshot from clipboard items without any disk path', () => {
  const image = new File(['pixels'], 'image.png', { type: 'image/png' });
  const data = { files: [], types: ['Files'], items: [{ kind: 'file', getAsFile: () => image }] } as unknown as DataTransfer;
  expect(hasTransferredFiles(data)).toBe(true);
  expect(transferredFiles(data)).toEqual([image]);
});

it('does not duplicate a file listed in both DataTransfer files and items', () => {
  const image = new File(['pixels'], 'image.png', { type: 'image/png' });
  const data = { files: [image], types: ['Files'], items: [{ kind: 'file', getAsFile: () => image }] } as unknown as DataTransfer;
  expect(transferredFiles(data)).toEqual([image]);
});

it('leaves text/HTML clipboard data alone and ignores unavailable file items', () => {
  const text = { files: [], types: ['text/plain', 'text/html'], items: [{ kind: 'string' }] } as unknown as DataTransfer;
  expect(hasTransferredFiles(text)).toBe(false);
  expect(transferredFiles(text)).toEqual([]);
  expect(transferredFiles(null)).toEqual([]);
  expect(transferredFiles({ files: [], items: [{ kind: 'file', getAsFile: (): File | null => null }] } as unknown as DataTransfer)).toEqual([]);
});

it('recognizes a dragged Windows image even if its MIME type is missing', () => {
  expect(isImageFile(new File(['pixels'], '截图.PNG'))).toBe(true);
  expect(isImageFile(new File(['text'], 'notes.txt'))).toBe(false);
});
