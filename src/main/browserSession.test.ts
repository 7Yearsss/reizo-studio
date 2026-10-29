import { expect, it } from 'vitest';
import { publicBrowserRequest } from './browserSession';

it('blocks private DNS and every local URL before allowing browser media requests', async () => {
  for (const url of ['file:///secret', 'http://127.0.0.1:47100/api/settings', 'http://169.254.169.254/', 'https://user:pw@example.com']) expect(await publicBrowserRequest(url)).toBe(false);
  expect(await publicBrowserRequest('https://public.example/a', async () => ['10.0.0.1'])).toBe(false);
  expect(await publicBrowserRequest('https://public.example/a', async () => ['93.184.216.34', '192.168.0.1'])).toBe(false);
  expect(await publicBrowserRequest('https://public.example/a', async () => ['93.184.216.34'])).toBe(true);
  expect(await publicBrowserRequest('blob:https://public.example/id')).toBe(true);
});
