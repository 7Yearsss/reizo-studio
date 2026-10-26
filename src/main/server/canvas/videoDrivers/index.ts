import type { VideoDriver } from './types';
import { mockDriver } from './mockDriver';
import { falDriver } from './falDriver';
import { klingDriver } from './klingDriver';
import { newApiDriver } from './newApiDriver';

export * from './types';
export { mockDriver, falDriver, klingDriver };

const DRIVERS: Record<string, VideoDriver> = {
  'new-api': newApiDriver,
  mock: mockDriver,
  fal: falDriver,
  kling: klingDriver,
};

export function getVideoDriver(id?: string): VideoDriver {
  if (id && DRIVERS[id]) return DRIVERS[id];
  return mockDriver;
}

export function listVideoDrivers(): Array<{ id: string; name: string }> {
  return Object.values(DRIVERS).map((d) => ({ id: d.id, name: d.name }));
}
