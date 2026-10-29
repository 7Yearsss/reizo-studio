export type BusyLane = 'queue' | 'steer';

/** Which lane a send takes while a turn runs: Enter follows the preference, holding Ctrl/Cmd takes the other one. */
export function activeBusyLane(preferred: BusyLane, modifierDown: boolean): BusyLane {
  if (!modifierDown) return preferred;
  return preferred === 'steer' ? 'queue' : 'steer';
}
