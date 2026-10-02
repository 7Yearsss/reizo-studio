import type { AudioDriver } from './types';
import { mockAudioDriver } from './mockDriver';
import { minimaxAudioDriver } from './minimaxDriver';
import { cosyvoiceAudioDriver } from './cosyvoiceDriver';

export * from './types';
export { mockAudioDriver } from './mockDriver';
export { minimaxAudioDriver } from './minimaxDriver';
export { cosyvoiceAudioDriver } from './cosyvoiceDriver';

const DRIVERS: Record<string, AudioDriver> = {
  mock: mockAudioDriver,
  minimax: minimaxAudioDriver,
  cosyvoice: cosyvoiceAudioDriver,
};

export function getAudioDriver(driverType: string): AudioDriver {
  const driver = DRIVERS[driverType?.trim().toLowerCase()];
  if (!driver) {
    throw new Error(`Unknown audio driver: ${driverType}`);
  }
  return driver;
}

export function listAudioDrivers(): AudioDriver[] {
  return Object.values(DRIVERS);
}
